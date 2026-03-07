# Anagrams Live

A simple realtime browser version of your tile-flip anagrams game.

## What it does
- Create a private room and share the link.
- Flip one tile at a time into the middle.
- Play a word from one form, whether you are claiming from the middle or stealing.
- Challenge a disputed steal with a room vote.
- Vote on unknown words instead of rejecting them immediately.
- Track live scores using your house rule: each word scores `length - 3`.
- Play with turn-based flipping: whoever most recently claimed or stole gets the next flip, then flips rotate around the table order.
- Hear a sound when a tile is flipped and a different sound when someone steals.

## House rules implemented
- Minimum word length is 4.
- Proper nouns are blocked.
- You cannot remove letters from an existing word to steal it.
- A steal must add at least one middle tile.
- Claims and steals reset who gets the next flip.
- A challenge pauses the room and opens a vote.
- Unknown words can also go to a vote.
- Regular inflections such as common plurals and simple `-ed` / `-ing` / `-er` / `-est` forms are accepted when the base word exists.
- If a vote ties or loses, the challenged or unknown word is rejected.
- The app does not try to decide English roots automatically.

## Run locally
```bash
cd /Users/ari/Desktop/anagrams
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Deploy fast
### Render
1. Create a new GitHub repo from `/Users/ari/Desktop/anagrams`.
2. Push the project.
3. In Render, click `New +` and choose `Blueprint`.
4. Connect the repo and let Render read `render.yaml`.
5. Let the Blueprint create both the web service and the Postgres database.
6. Approve the Blueprint sync so `DATABASE_URL` is attached automatically.
7. Deploy, then send the generated URL to your girlfriend.

### Railway
1. Push this folder to GitHub.
2. Create a new Railway project from the repo.
3. Railway will run `npm start` automatically.

## Notes
- If `DATABASE_URL` is set, room state is stored in Postgres and survives web-service redeploys/restarts.
- Without `DATABASE_URL`, room state stays in server memory and is lost on restart.
- Free Render Postgres persists room state, but Render expires free Postgres instances after 30 days unless upgraded.
- The bundled dictionary now includes both `web2` and `web2a`, filtered against proper names.
- Browser sound requires at least one tap or keypress in the page before the browser will play audio.
