import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;
const API_BASE = "https://v3.football.api-sports.io";

app.use(express.json());
app.use(express.static("."));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    apiConfigured: !!API_KEY,
    version: "7.1"
  });
});

// Get fixtures for a date
app.get("/api/fixtures", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: "API_FOOTBALL_KEY has not been set." });
    }

    const date = req.query.date;
    if (!date) {
      return res.status(400).json({ error: "Date is required." });
    }

    const response = await fetch(
      `${API_BASE}/fixtures?date=${encodeURIComponent(date)}&timezone=Africa/Accra`,
      {
        headers: { "x-apisports-key": API_KEY }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data.response || []);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Unable to retrieve fixtures.",
      details: error.message
    });
  }
});

// Get detailed match + prediction
app.get("/api/match/:id", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: "API_FOOTBALL_KEY has not been set." });
    }

    const id = req.params.id;

    const fixtureRes = await fetch(
      `${API_BASE}/fixtures?id=${encodeURIComponent(id)}`,
      { headers: { "x-apisports-key": API_KEY } }
    );
    const fixtureData = await fixtureRes.json();

    if (!fixtureRes.ok || !fixtureData.response || fixtureData.response.length === 0) {
      return res.status(404).json({ error: "Fixture not found." });
    }

    const fixture = fixtureData.response[0];
    const homeTeam = fixture.teams.home.id;
    const awayTeam = fixture.teams.away.id;
    const league = fixture.league.id;
    const season = fixture.league.season;

    const endpoints = [
      `/teams/statistics?league=${league}&season=${season}&team=${homeTeam}`,
      `/teams/statistics?league=${league}&season=${season}&team=${awayTeam}`,
      `/fixtures?team=${homeTeam}&last=10`,
      `/fixtures?team=${awayTeam}&last=10`,
      `/fixtures/headtohead?h2h=${homeTeam}-${awayTeam}&last=10`,
      `/injuries?league=${league}&season=${season}&team=${homeTeam}`,
      `/injuries?league=${league}&season=${season}&team=${awayTeam}`
    ];

    const results = await Promise.all(
      endpoints.map(async (endpoint) => {
        try {
          const r = await fetch(API_BASE + endpoint, {
            headers: { "x-apisports-key": API_KEY }
          });
          const json = await r.json();
          return json.response || [];
        } catch {
          return [];
        }
      })
    );

    const homeStats = results[0];
    const awayStats = results[1];
    const homeLast = results[2];
    const awayLast = results[3];
    const h2h = results[4];
    const homeInjuries = results[5];
    const awayInjuries = results[6];
const prediction = calculatePrediction({
  fixture,
  homeStats,
  awayStats,
  homeLast,
  awayLast,
  h2h,
  homeInjuries,
  awayInjuries
});

const transformedPrediction = {
  H: prediction.home,
  D: prediction.draw,
  A: prediction.away,
  winner: prediction.predicted,
  conf: prediction.confidence / 100,
  lh: 0,
  la: 0,
  score: "0 - 0",
  O: 0.45,
  B: 0.55,
  hf: prediction.form.home,
  af: prediction.form.away,
  hi: prediction.injuries.home,
  ai: prediction.injuries.away
};

try {
  const hs = homeStats?.[0] || {};
  const as = awayStats?.[0] || {};

  const hg = +(hs.goals?.for?.average?.home ||
    hs.goals?.for?.average?.total || 1.35);

  const ag = +(as.goals?.for?.average?.away ||
    as.goals?.for?.average?.total || 1.1);

  const hc = +(hs.goals?.against?.average?.home ||
    hs.goals?.against?.average?.total || 1);

  const ac = +(as.goals?.against?.average?.away ||
    as.goals?.against?.average?.total || 1.2);

  const hi = (homeInjuries || []).length;
  const ai = (awayInjuries || []).length;

  transformedPrediction.lh = Math.max(
    0.15,
    (hg + ac) / 2 + 0.15 - Math.max(0, hi - ai) * 0.02
  );

  transformedPrediction.la = Math.max(
    0.15,
    (ag + hc) / 2 - Math.max(0, ai - hi) * 0.02
  );

  let H = 0;
  let D = 0;
  let A = 0;
  let O = 0;
  let B = 0;
  let bestP = 0;
  let bestH = 0;
  let bestA = 0;

  function fact(n) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function poi(k, lambda) {
    return Math.exp(-lambda) * Math.pow(lambda, k) / fact(k);
  }

  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p =
        poi(h, transformedPrediction.lh) *
        poi(a, transformedPrediction.la);

      if (h > a) H += p;
      else if (h === a) D += p;
      else A += p;

      if (h + a >= 3) O += p;
      if (h > 0 && a > 0) B += p;

      if (p > bestP) {
        bestP = p;
        bestH = h;
        bestA = a;
      }
    }
  }

  const total = H + D + A;

  transformedPrediction.H = H / total;
  transformedPrediction.D = D / total;
  transformedPrediction.A = A / total;
  transformedPrediction.O = O / total;
  transformedPrediction.B = B / total;
  transformedPrediction.score = `${bestH} - ${bestA}`;

} catch (e) {
  console.error("Prediction calculation error:", e);
}

res.json({
  fixture,
  homeStats,
  awayStats,
  homeLast,
  awayLast,
  h2h,
  homeInjuries,
  awayInjuries,
  prediction: transformedPrediction
});
  
      fixture,
      homeStats,
      awayStats,
      homeLast,
      awayLast,
      h2h,
      homeInjuries,
      awayInjuries,
      prediction
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Unable to analyze match.",
      details: error.message
    });
  }
});

function calculatePrediction({ fixture, homeStats, awayStats, homeLast, awayLast, h2h, homeInjuries, awayInjuries }) {
  function getFormPoints(matches, teamId) {
    let points = 0;
    let played = 0;
    let gf = 0;
    let ga = 0;

    (matches || []).slice(0, 8).forEach((m) => {
      if (!m.goals || m.goals.home === null) return;
      played++;
      const isHome = m.teams.home.id === teamId;
      const teamGoals = isHome ? m.goals.home : m.goals.away;
      const oppGoals = isHome ? m.goals.away : m.goals.home;

      gf += teamGoals || 0;
      ga += oppGoals || 0;

      if (teamGoals > oppGoals) points += 3;
      else if (teamGoals === oppGoals) points += 1;
    });

    return {
      points,
      played: played || 0,
      avgPoints: played ? points / played : 1.0,   // default to average if no data
      gf,
      ga,
      gd: gf - ga
    };
  }

  const homeForm = getFormPoints(homeLast, fixture.teams.home.id);
  const awayForm = getFormPoints(awayLast, fixture.teams.away.id);

  // H2H
  let h2hHome = 0, h2hAway = 0, h2hDraw = 0, h2hPlayed = 0;
  (h2h || []).forEach((m) => {
    if (!m.goals || m.goals.home === null) return;
    h2hPlayed++;
    if (m.goals.home > m.goals.away) {
      if (m.teams.home.id === fixture.teams.home.id) h2hHome++;
      else h2hAway++;
    } else if (m.goals.home < m.goals.away) {
      if (m.teams.away.id === fixture.teams.home.id) h2hHome++;
      else h2hAway++;
    } else {
      h2hDraw++;
    }
  });

  // Injury penalty
  const homeInjuryPenalty = Math.min((homeInjuries || []).length * 0.015, 0.08);
  const awayInjuryPenalty = Math.min((awayInjuries || []).length * 0.015, 0.08);

  // Base strength (now has a floor so it never goes to zero)
  let homeStrength = (homeForm.avgPoints * 1.15) + (homeForm.gd / 12) * 0.25 + 0.35;
  let awayStrength = (awayForm.avgPoints * 0.95) + (awayForm.gd / 12) * 0.25 + 0.25;

  // Add H2H influence if available
  if (h2hPlayed > 0) {
    homeStrength += (h2hHome / h2hPlayed) * 0.35;
    awayStrength += (h2hAway / h2hPlayed) * 0.35;
  }

  homeStrength = Math.max(0.25, homeStrength - homeInjuryPenalty);
  awayStrength = Math.max(0.25, awayStrength - awayInjuryPenalty);

  // Draw base
  const drawBase = 0.75;
  const total = homeStrength + awayStrength + drawBase;

  let homeProb = homeStrength / total;
  let awayProb = awayStrength / total;
  let drawProb = drawBase / total;

  // Normalize
  const sum = homeProb + drawProb + awayProb;
  homeProb = +(homeProb / sum).toFixed(3);
  drawProb = +(drawProb / sum).toFixed(3);
  awayProb = +(awayProb / sum).toFixed(3);

  // Confidence
  let confidence = 50;
  if (homeForm.played >= 5 && awayForm.played >= 5) confidence += 20;
  else if (homeForm.played >= 3 || awayForm.played >= 3) confidence += 10;
  if (h2hPlayed >= 3) confidence += 10;
  if ((homeInjuries || []).length + (awayInjuries || []).length < 4) confidence += 5;
  confidence = Math.min(90, confidence);

  let predicted = "Draw";
  if (homeProb > drawProb && homeProb > awayProb) predicted = "Home";
  else if (awayProb > drawProb && awayProb > homeProb) predicted = "Away";

  return {
    home: Math.round(homeProb * 100),
    draw: Math.round(drawProb * 100),
    away: Math.round(awayProb * 100),
    predicted,
    confidence,
    form: {
      home: homeForm,
      away: awayForm
    },
    h2hSummary: {
      played: h2hPlayed,
      homeWins: h2hHome,
      draws: h2hDraw,
      awayWins: h2hAway
    },
    injuries: {
      home: (homeInjuries || []).length,
      away: (awayInjuries || []).length
    }
  };
} 
// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Football AI Predictor running on port ${PORT}`);
});

