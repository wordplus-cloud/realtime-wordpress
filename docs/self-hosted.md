# Other servers

The SDK talks to the WordPlus Cloud servers by default. Four filters point it elsewhere:

| Filter | Default | |
|---|---|---|
| `wordplus_realtime_server` | `https://ws.wordplus.cloud/` | where browsers connect |
| `wordplus_realtime_api_server` | `https://rest.wordplus.cloud/` | where the site emits and questions, and the leave of a closing page, go |
| `wordplus_realtime_account` | `https://www.wordplus.cloud/` | where Connect sends the administrator |
| `wordplus_realtime_account_api` | `https://api.wordplus.cloud/` | where the Connect code is exchanged |

They are for a development server and for tests: the example `check.mjs` points them at a realtime server on the same machine.

**A self-hosted WordPlus Cloud server does not run the SDK yet.** It knows its sites by their licence keys, while rooms and calls need the credentials of each site and the features of its plan, which only the WordPlus Cloud servers have for now. A site on a self-hosted server uses the WordPlus plugins there as before.
