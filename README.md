Football AI Predictor V6

V6 adds:
- weighted recent form
- injury input
- persistent local prediction history
- model dashboard
- live fixture analysis

## API key
Copy .env.example to .env and set:
API_FOOTBALL_KEY=YOUR_REAL_KEY

## Run
npm install
npm start
Open http://localhost:3000

## Important
Prediction history is stored in the browser's localStorage in V6. It is not yet a server database.

## V7
Recommended next:
- server-side database
- automatic final-score syncing
- true hit-rate and calibration tracking
- feature logging
- proper train/validation/test model
- player-level availability impact
- richer xG/shots features
