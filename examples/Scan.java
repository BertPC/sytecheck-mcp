/*
 * Submit a scan, poll until it finishes, print a summary.
 *
 *   export SYTECHECK_API_KEY=wak_...
 *   java Scan.java https://example.com
 *
 * Single file, no build tool and no third-party dependencies — java.net.http is
 * in the JDK from 11, and this runs directly with `java Scan.java` from 11+.
 *
 * The JSON is read with small string helpers rather than a parser, purely to keep
 * this dependency-free and readable as an illustration of the HTTP flow. In a real
 * service use Jackson or Gson; do not grow these helpers into a parser.
 */

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Set;

public class Scan {

    private static final String API_URL =
            System.getenv().getOrDefault("SYTECHECK_API_URL", "https://api.sytecheck.app");
    private static final String API_KEY = System.getenv("SYTECHECK_API_KEY");

    // A scan runs a browser and a Lighthouse audit, so minutes is normal.
    private static final Duration POLL_INTERVAL = Duration.ofSeconds(5);
    private static final Duration TIMEOUT = Duration.ofMinutes(10);
    private static final Set<String> TERMINAL = Set.of("complete", "failed");

    private static final HttpClient CLIENT =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: java Scan.java <url>");
            System.exit(2);
        }
        if (API_KEY == null || API_KEY.isBlank()) {
            System.err.println("Set SYTECHECK_API_KEY (Account -> API keys).");
            System.exit(1);
        }

        HttpResponse<String> created = send(
                request("/api/v1/scans")
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(
                                "{\"url\":\"" + args[0] + "\"}")));

        if (created.statusCode() == 403) {
            // Worth separating: a 403 never becomes a 200 by retrying, a 429 does.
            System.err.println("Refused: " + stringField(created.body(), "detail"));
            System.exit(1);
        }
        if (created.statusCode() == 429) {
            System.err.println("Quota or rate limit reached; retry after "
                    + created.headers().firstValue("retry-after").orElse("?") + "s.");
            System.exit(1);
        }
        if (created.statusCode() >= 400) {
            System.err.println("HTTP " + created.statusCode() + ": " + created.body());
            System.exit(1);
        }

        String scanId = numberField(created.body(), "id");
        System.err.println("Scan " + scanId + " queued for " + args[0]);

        String status = stringField(created.body(), "status");
        long deadline = System.nanoTime() + TIMEOUT.toNanos();
        while (!TERMINAL.contains(status)) {
            if (System.nanoTime() > deadline) {
                System.err.println("Gave up waiting; scan is still " + status + ".");
                System.exit(1);
            }
            Thread.sleep(POLL_INTERVAL.toMillis());
            String body = send(request("/api/v1/scans/" + scanId).GET()).body();
            String next = stringField(body, "status");
            if (!next.equals(status)) {
                status = next;
                System.err.println("  ... " + status);
            }
        }

        if (status.equals("failed")) {
            String body = send(request("/api/v1/scans/" + scanId).GET()).body();
            System.err.println("Scan failed: " + stringField(body, "error_message"));
            System.exit(1);
        }

        String report = send(request("/api/v1/scans/" + scanId + "/report").GET()).body();
        System.out.println("Overall score: " + numberField(report, "overall_score") + "/100");
        System.out.println("Full report JSON follows.");
        System.out.println(report);
    }

    private static HttpRequest.Builder request(String path) {
        return HttpRequest.newBuilder(URI.create(API_URL + path))
                .header("Authorization", "Bearer " + API_KEY)
                .timeout(Duration.ofSeconds(30));
    }

    private static HttpResponse<String> send(HttpRequest.Builder builder) throws Exception {
        return CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    }

    /** Read a top-level string field. Illustrative only — use a real JSON library. */
    private static String stringField(String json, String key) {
        int at = json.indexOf("\"" + key + "\"");
        if (at < 0) return "";
        int start = json.indexOf('"', json.indexOf(':', at) + 1);
        if (start < 0) return "";
        int end = json.indexOf('"', start + 1);
        return end < 0 ? "" : json.substring(start + 1, end);
    }

    /** Read a top-level numeric field. Illustrative only — use a real JSON library. */
    private static String numberField(String json, String key) {
        int at = json.indexOf("\"" + key + "\"");
        if (at < 0) return "";
        int cursor = json.indexOf(':', at) + 1;
        while (cursor < json.length() && Character.isWhitespace(json.charAt(cursor))) {
            cursor++;
        }
        int start = cursor;
        while (cursor < json.length() && "-.0123456789".indexOf(json.charAt(cursor)) >= 0) {
            cursor++;
        }
        // Empty when the value is null, which overall_score legitimately is while
        // a scan is running or when every category was blocked.
        return json.substring(start, cursor);
    }
}
