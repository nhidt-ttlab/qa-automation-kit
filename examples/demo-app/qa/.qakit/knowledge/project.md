# Demo shop — project knowledge

- The server is `examples/demo-app/server.mjs`; the default user is `qa` / `secret`.
- Data is in memory and resets on restart: orders `o-1001` (Acme Corp), `o-1002` (Globex), `o-1003` (Acme Labs).
- The order list page (`/orders`) filters client-side on customer; `#count` shows `<n> orders`.
- Tokens are stored in `localStorage` under `token`; a 401 from the API sends the page back to `/login`.
