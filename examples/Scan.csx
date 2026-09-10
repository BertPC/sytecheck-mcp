#!/usr/bin/env dotnet-script
/*
 * Submit a scan, poll until it finishes, print a summary.
 *
 *   export SYTECHECK_API_KEY=sck_...
 *   dotnet script Scan.csx -- https://example.com
 *
 * Or drop the body into a console project's Program.cs and run it with
 * `dotnet run https://example.com`.
 *
 * No third-party packages: HttpClient and System.Text.Json are both in the BCL.
 */

using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

var apiUrl = Environment.GetEnvironmentVariable("SYTECHECK_API_URL")
             ?? "https://api.sytecheck.app";
var apiKey = Environment.GetEnvironmentVariable("SYTECHECK_API_KEY");

// A scan runs a browser and a Lighthouse audit, so minutes is normal.
var pollInterval = TimeSpan.FromSeconds(5);
var timeout = TimeSpan.FromMinutes(10);
var terminal = new HashSet<string> { "complete", "failed" };

var url = Args.Count > 0 ? Args[0] : null;
if (url is null)
{
    Console.Error.WriteLine("usage: dotnet script Scan.csx -- <url>");
    return 2;
}
if (string.IsNullOrWhiteSpace(apiKey))
{
    Console.Error.WriteLine("Set SYTECHECK_API_KEY (Account -> API keys).");
    return 1;
}

using var http = new HttpClient { BaseAddress = new Uri(apiUrl), Timeout = TimeSpan.FromSeconds(30) };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

var body = new StringContent(
    JsonSerializer.Serialize(new { url }), Encoding.UTF8, "application/json");
var created = await http.PostAsync("/api/v1/scans", body);

if (created.StatusCode == HttpStatusCode.Forbidden)
{
    // Worth separating: a 403 never becomes a 200 by retrying, a 429 does.
    Console.Error.WriteLine($"Refused: {await Detail(created)}");
    return 1;
}
if (created.StatusCode == HttpStatusCode.TooManyRequests)
{
    var retry = created.Headers.TryGetValues("retry-after", out var v) ? string.Join("", v) : "?";
    Console.Error.WriteLine($"Quota or rate limit reached; retry after {retry}s.");
    return 1;
}
created.EnsureSuccessStatusCode();

var scan = JsonDocument.Parse(await created.Content.ReadAsStringAsync()).RootElement;
var scanId = scan.GetProperty("id").GetInt32();
var status = scan.GetProperty("status").GetString()!;
Console.Error.WriteLine($"Scan {scanId} queued for {url}");

var deadline = DateTime.UtcNow + timeout;
while (!terminal.Contains(status))
{
    if (DateTime.UtcNow > deadline)
    {
        Console.Error.WriteLine($"Gave up waiting; scan {scanId} is still {status}.");
        return 1;
    }
    await Task.Delay(pollInterval);
    var poll = await http.GetStringAsync($"/api/v1/scans/{scanId}");
    var next = JsonDocument.Parse(poll).RootElement.GetProperty("status").GetString()!;
    if (next != status)
    {
        status = next;
        Console.Error.WriteLine($"  ... {status}");
    }
}

if (status == "failed")
{
    var failed = await http.GetStringAsync($"/api/v1/scans/{scanId}");
    var message = JsonDocument.Parse(failed).RootElement.GetProperty("error_message");
    Console.Error.WriteLine($"Scan failed: {message}");
    return 1;
}

var report = JsonDocument.Parse(await http.GetStringAsync($"/api/v1/scans/{scanId}/report")).RootElement;
var overall = report.GetProperty("overall_score");
Console.WriteLine($"\n{report.GetProperty("url").GetString()} — overall score {overall}/100\n");

foreach (var category in report.GetProperty("categories").EnumerateArray())
{
    var scoreProp = category.GetProperty("score");
    // null is legitimate: a blocked or errored category is excluded from the
    // overall score rather than counted as a failure.
    var score = scoreProp.ValueKind == JsonValueKind.Null
        ? "n/a"
        : Math.Round(scoreProp.GetDouble()).ToString();

    Console.WriteLine(
        $"{category.GetProperty("category").GetString(),-20} " +
        $"{category.GetProperty("status").GetString(),-8} {score,5}");

    foreach (var finding in category.GetProperty("findings").EnumerateArray().Take(3))
    {
        Console.WriteLine(
            $"    [{finding.GetProperty("severity").GetString()}] " +
            finding.GetProperty("title").GetString());
    }
}
return 0;

static async Task<string> Detail(HttpResponseMessage response)
{
    try
    {
        var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.TryGetProperty("detail", out var d) ? d.ToString() : "";
    }
    catch (JsonException)
    {
        // A gateway or WAF page rather than JSON.
        return $"{(int)response.StatusCode} {response.ReasonPhrase}";
    }
}
