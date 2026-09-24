import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_FOOTBALL_KEY;

const API_BASE = "https://v3.football.api-sports.io";

app.use(express.json());

// Serve your website files from the GitHub root
app.use(express.static("."));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    apiConfigured: !!API_KEY
  });
});

// Get fixtures for a date
app.get("/api/fixtures", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "API_FOOTBALL_KEY has not been added to Railway."
      });
    }

    const date = req.query.date;

    if (!date) {
      return res.status(400).json({
        error: "Date is required."
      });
    }

    const response = await fetch(
      `${API_BASE}/fixtures?date=${encodeURIComponent(
        date
      )}&timezone=Africa/Accra`,
      {
        headers: {
          "x-apisports-key": API_KEY
        }
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

// Get detailed match information
app.get("/api/match/:id", async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({
        error: "API_FOOTBALL_KEY has not been added to Railway."
      });
    }

    const id = req.params.id;

    const response = await fetch(
      `${API_BASE}/fixtures?id=${encodeURIComponent(id)}`,
      {
        headers: {
          "x-apisports-key": API_KEY
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    if (!data.response || data.response.length === 0) {
      return res.status(404).json({
        error: "Fixture not found."
      });
    }

    const fixture = data.response[0];

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
            headers: {
              "x-apisports-key": API_KEY
            }
          });

          const json = await r.json();

          return json.response || [];
        } catch {
          return [];
        }
      })
    );

    res.json({
      fixture,
      homeStats: results[0],
      awayStats: results[1],
      homeLast: results[2],
      awayLast: results[3],
      h2h: results[4],
      homeInjuries: results[5],
      awayInjuries: results[6]
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Unable to analyze match.",
      details: error.message
    });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Football AI Predictor running on port ${PORT}`);
});
