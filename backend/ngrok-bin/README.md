# Manual ngrok Binary

If automatic ngrok download fails due to network issues, download the ngrok v3
Linux x86_64 build from https://ngrok.com/download and place the extracted
`ngrok` binary in this directory.

## Steps:

1. Download: https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
   Or: https://ngrok.com/download (Linux tab → x86_64)
2. Extract: `tar -xzf ngrok-v3-stable-linux-amd64.tgz`
3. Place the `ngrok` binary here: `backend/ngrok-bin/ngrok`
4. Make it executable: `chmod +x backend/ngrok-bin/ngrok`
5. Restart backend: `docker compose restart backend`

The backend will auto-detect this binary and skip the download.
