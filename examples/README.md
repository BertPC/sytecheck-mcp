# Examples

Runnable clients for the SyteCheck public API. Each does the same thing — submit a
scan, poll until it finishes, print the report — so you can read whichever language
you work in and ignore the rest.

All of them need an API key:

```bash
export SYTECHECK_API_KEY=wak_your_key_here
```

Create one at [sytecheck.app](https://sytecheck.app) under **Account → API keys**.
A free account works; it includes three scans a month.

| File                                         | Run it                                                          |
| -------------------------------------------- | --------------------------------------------------------------- |
| [`scan.sh`](scan.sh)                         | `./scan.sh https://example.com` (needs `curl` and `jq`)         |
| [`scan.py`](scan.py)                         | `pip install httpx && python scan.py https://example.com`       |
| [`scan.mjs`](scan.mjs)                       | `node scan.mjs https://example.com` (no dependencies)           |
| [`Scan.java`](Scan.java)                     | `java Scan.java https://example.com` (JDK 11+, no dependencies) |
| [`Scan.csx`](Scan.csx)                       | `dotnet script Scan.csx -- https://example.com`                 |
| [`webhook_receiver.py`](webhook_receiver.py) | `python webhook_receiver.py` (standard library only)            |

Point any of them at a local instance with `SYTECHECK_API_URL=http://localhost:8000`.

## Notes

**Scans cost money and quota.** Running these spends from your monthly allowance,
so on a free account you have three attempts before the next calendar month. Every
example polls rather than re-submitting for that reason.

**Read the error handling, not just the happy path.** The distinction that matters
in production is between `403` and `429`: a `403` is a permission or plan
limitation that will never succeed on retry, while a `429` is a quota or rate
limit that will, after `Retry-After`. Each example separates them.

**`Scan.java` parses JSON with string helpers**, deliberately, so it runs with no
build tool and no dependencies. That is fine for an illustration of the HTTP flow
and wrong for a real service — use Jackson or Gson there. Every other example uses
its language's real JSON support.

**The webhook receiver is the one worth copying carefully.** It shows the two
things that break signature verification in practice: signing a re-serialized body
instead of the raw bytes, and comparing digests with `==` instead of a constant-time
comparison. See [`../docs/API.md`](../docs/API.md) §4 for the same recipe in Node,
Java, and C#.
