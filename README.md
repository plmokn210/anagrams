# Anagrams Live

A simple realtime browser version of your tile-flip anagrams game.

## What it does
- Create a private room and share the link.
- Flip one tile at a time into the middle.
- Claim a word from the center once you see one.
- Steal a word by adding letters from the center.
- Challenge a disputed steal and revert the last steal on that word.
- Track live scores using your house rule: each word scores `length - 3`.

## House rules implemented
- Minimum word length is 4.
- Proper nouns are blocked.
- You cannot remove letters from an existing word to steal it.
- A steal must add at least one middle tile.
- Root disputes are player-enforced through the `Challenge` button.
- The app does not try to decide English roots automatically.

## Run locally
```bash
cd /Users/ari/Desktop/anagrams
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Deploy fast
### Render
1. Create a new GitHub repo from `/Users/ari/Desktop/anagrams`.
2. Push the project.
3. In Render, create a new Web Service from that repo.
4. Render will detect `render.yaml`.
5. Deploy and send the generated URL to your girlfriend.

### Railway
1. Push this folder to GitHub.
2. Create a new Railway project from the repo.
3. Railway will run `npm start` automatically.

## Notes
- Room state is stored in server memory, which is fine for a quick two-player game.
- If the server restarts, active rooms are lost.
- The bundled dictionary comes from a filtered system word list so hosted validation behaves the same way.
