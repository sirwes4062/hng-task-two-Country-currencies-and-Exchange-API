import express from "express";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import { createCanvas } from "canvas";
import fs from "fs/promises";
import path from "path";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// ⚠️ NEW/UPDATED Constants
const COUNTRIES_API =
  "https://restcountries.com/v2/all?fields=name,capital,region,population,flag,currencies";
const RATES_API = "https://open.er-api.com/v6/latest/USD";
const CACHE_IMAGE_PATH = path.join(process.cwd(), "cache", "summary.png"); // Use path.join for OS compatibility

// MySQL Configuration
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
};

// --- Helper Functions ---

/**
 * Generates a random integer between min and max (inclusive).
 */
const getRandomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Custom validation function for required fields.
 * @param {Object} data - The country object to validate.
 * @returns {Object} Validation error details or null if valid.
 */
function validateCountryData(data) {
  const errors = {};
  if (!data.name || data.name.trim() === "") {
    errors.name = "is required";
  }
  if (
    !data.population ||
    typeof data.population !== "number" ||
    data.population < 0
  ) {
    errors.population = "must be a positive number";
  } // Only require currency_code if it was successfully parsed (i.e., not explicitly set to null/0 during refresh)
  if (!data.currency_code) {
    errors.currency_code = "is required";
  }

  return Object.keys(errors).length > 0
    ? { error: "Validation failed", details: errors }
    : null;
}

// --- Database Logic ---

/**
 * Stores or updates the processed country data in the MySQL database (UPSERT).
 */
async function cacheDataInMySQL(data, connection) {
  console.log(`Caching ${data.length} records in MySQL...`);

  const sql = `
 INSERT INTO country_cache 
 (name, capital, region, population, currency_code, exchange_rate, estimated_gdp, flag_url)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
 ON DUPLICATE KEY UPDATE
 capital = VALUES(capital),
 region = VALUES(region),
 population = VALUES(population),
 currency_code = VALUES(currency_code),
 exchange_rate = VALUES(exchange_rate),
 estimated_gdp = VALUES(estimated_gdp),
 flag_url = VALUES(flag_url);
 `;

  for (const record of data) {
    const values = [
      record.name,
      record.capital,
      record.region,
      record.population,
      record.currency_code,
      record.exchange_rate,
      record.estimated_gdp,
      record.flag_url,
    ];

    await connection.execute(sql, values);
  }
  console.log("Caching complete.");
}

/**
 * Updates the api_status table with total count and refresh timestamp.
 */
async function updateStatus(connection, totalCountries) {
  const now = new Date().toISOString();
  const nowMySQL = now.slice(0, 19).replace("T", " "); // Format for MySQL TIMESTAMP // Update total countries

  await connection.execute(
    `INSERT INTO api_status (total_countries) VALUES (?) 
        ON DUPLICATE KEY UPDATE total_countries = VALUES(total_countries)`,
    [totalCountries.toString()]
  ); // Update last refresh timestamp

  await connection.execute(
    `INSERT INTO api_status (last_refreshed_at) VALUES (?) 
        ON DUPLICATE KEY UPDATE last_refreshed_at = VALUES(last_refreshed_at)`,
    [nowMySQL]
  );
  return now; // Return ISO string for API response
}

// --- External Data Fetching and Processing ---

/**
 * Fetches, calculates GDP, and prepares the final data array.
 */
async function getCurrencyData() {
  try {
    const [countriesResponse, ratesResponse] = await Promise.all([
      fetch(COUNTRIES_API),
      fetch(RATES_API),
    ]);

    if (!countriesResponse.ok) {
      throw new Error(
        `Could not fetch data from Restcountries: ${countriesResponse.statusText}`
      );
    }
    if (!ratesResponse.ok) {
      throw new Error(
        `Could not fetch data from Open ER API: ${ratesResponse.statusText}`
      );
    }

    const [countriesData, ratesData] = await Promise.all([
      countriesResponse.json(),
      ratesResponse.json(),
    ]);

    const rates = ratesData.rates;
    const countriesToCache = [];

    for (const country of countriesData) {
      let currencyCode = null;
      let rate = null;
      let estimated_gdp = null;

      const population = country.population || 0;
      const currencies = country.currencies; // --- Currency Handling ---

      if (currencies && currencies.length > 0 && currencies[0].code) {
        currencyCode = currencies[0].code; // --- Rate Lookup and GDP Calculation ---

        if (rates.hasOwnProperty(currencyCode)) {
          rate = rates[currencyCode];

          if (population > 0 && rate !== 0) {
            const gdpMultiplier = getRandomInt(1000, 2000); // Formula: estimated_gdp = population × random(1000–2000) ÷ exchange_rate
            estimated_gdp = (population * gdpMultiplier) / rate;
          } else {
            estimated_gdp = 0; // Valid currency, but population is zero
          }
        } else {
          // Case: Currency code found, but no exchange rate available. rate/gdp remain null.
          console.warn(
            `Rate not found for currency: ${currencyCode} (${country.name})`
          );
        }
      } else {
        // Case: No currency code found. currencyCode/rate remain null, gdp is 0.
        estimated_gdp = 0;
      } // --- Build the Cache Object ---

      countriesToCache.push({
        name: country.name,
        capital: country.capital || null,
        region: country.region || null,
        population: population,
        currency_code: currencyCode,
        exchange_rate: rate,
        estimated_gdp: estimated_gdp,
        flag_url: country.flag || null,
      });
    }

    return countriesToCache;
  } catch (error) {
    // Re-throw specific error for the route handler to catch and translate to 503
    console.error("Error fetching external data:", error.message);
    throw new Error(`External data source unavailable: ${error.message}`);
  }
}

// --- Image Generation Logic ---

async function generateSummaryImage(connection, lastRefreshedAt) {
  const width = 800;
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d"); // Fetch top 5 for the image

  const [topGdpRows] = await connection.execute(
    "SELECT name, estimated_gdp FROM country_cache WHERE estimated_gdp IS NOT NULL ORDER BY estimated_gdp DESC LIMIT 5"
  ); // Fetch status

  const [statusRows] = await connection.execute("SELECT * FROM api_status");
  const status = statusRows.reduce(
    (acc, row) => ({ ...acc, [row.key_name]: row.value_data }),
    {}
  );
  const totalCountries = status.total_countries || 0;
  const formattedDate = new Date(lastRefreshedAt).toLocaleString(); // Drawing Logic

  ctx.fillStyle = "#f0f0f0";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#333";
  ctx.font = "bold 30px Arial";
  ctx.fillText("Country Data API Summary", 30, 50);

  ctx.font = "18px Arial";
  ctx.fillText(`Total Countries Cached: ${totalCountries}`, 30, 100);
  ctx.fillText(`Last Refresh: ${formattedDate}`, 30, 130);

  ctx.font = "bold 18px Arial";
  ctx.fillText("Top 5 Countries by Estimated GDP (USD)", 30, 180);

  ctx.font = "16px Arial";
  topGdpRows.forEach((row, index) => {
    // Simple currency formatting (e.g., $123.45B)
    const gdpFormatted = (row.estimated_gdp / 1e9).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });

    ctx.fillText(
      `${index + 1}. ${row.name}: $${gdpFormatted} Billion`,
      30,
      210 + index * 30
    );
  }); // Save the file

  try {
    await fs.mkdir(path.dirname(CACHE_IMAGE_PATH), { recursive: true });
    const buffer = canvas.toBuffer("image/png");
    await fs.writeFile(CACHE_IMAGE_PATH, buffer);
    console.log(`Summary image saved to ${CACHE_IMAGE_PATH}`);
  } catch (err) {
    console.error("Failed to generate or save summary image:", err);
  }
}

// --- API Routes ---

/**
 * POST /countries/refresh: Fetches data, caches it, updates status, and generates image.
 */
app.post("/countries/refresh", async (req, res) => {
  let connection;
  try {
    // 1. Fetch and process data from external APIs
    const countriesToCache = await getCurrencyData(); // 2. Establish connection and cache

    connection = await mysql.createConnection(dbConfig);

    //   database connection
    console.log("Database connected successfully!");

    const queries = `CREATE TABLE IF NOT EXISTS country_cache (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,   
    capital VARCHAR(255),
    region VARCHAR(255),
    currency_code VARCHAR(10),
    flag_url VARCHAR(512),  
    population BIGINT DEFAULT 0,
    exchange_rate DOUBLE,
    estimated_gdp DOUBLE
);`;

    const status_query = `
    
    CREATE TABLE IF NOT EXISTS api_status (
      id INT AUTO_INCREMENT PRIMARY KEY,
      last_refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      total_countries INT DEFAULT 0
    );
  `;

    await connection.execute(queries);
    await connection.execute(status_query);

    await cacheDataInMySQL(countriesToCache, connection); // 3. Update the status table

    const refreshTime = await updateStatus(connection, countriesToCache.length); // 4. Generate the summary image

    await generateSummaryImage(connection, refreshTime);

    res.status(200).json({
      message: "Data refresh successful",
      total_countries: countriesToCache.length,
      last_refreshed_at: refreshTime,
    });
  } catch (error) {
    console.log(error.message);

    if (error.message.includes("External data source unavailable")) {
      return res.status(503).json({
        error: "External data source unavailable",
        details: error.message,
      });
    }
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// ----------------------------------------------------------------
// ⚠️ FIX IS APPLIED HERE: Static routes before dynamic routes.
// ----------------------------------------------------------------

/**
 * GET /countries/image: Serve the generated summary image. (MOVED UP)
 */
app.get("/countries/image", async (req, res) => {
  try {
    // Check if the file exists before trying to serve it
    await fs.access(CACHE_IMAGE_PATH); // Serve the file

    res.sendFile(CACHE_IMAGE_PATH);
  } catch (error) {
    // If fs.access throws an error (file not found or permission issue)
    res.status(404).json({ error: "Summary image not found" });
  }
});

/**
 * GET /countries: Get all countries from the DB (support filters and sorting).
 */
app.get("/countries", async (req, res) => {
  let connection;
  try {
    const { region, currency, sort } = req.query;
    let sql = "SELECT * FROM country_cache WHERE 1=1";
    const params = [];
    let orderClause = ""; // Filtering

    if (region) {
      sql += " AND region = ?";
      params.push(region);
    }
    if (currency) {
      sql += " AND currency_code = ?";
      params.push(currency);
    } // Sorting

    if (sort) {
      const [field, direction] = sort.toLowerCase().split("_");
      if (field === "gdp" && (direction === "asc" || direction === "desc")) {
        // Ensure NULL GDP values are handled gracefully (e.g., put last)
        orderClause = ` ORDER BY estimated_gdp IS NULL, estimated_gdp ${direction.toUpperCase()}`;
      } // Future: Add other sorting fields like 'population', 'name', etc.
    } else {
      orderClause = " ORDER BY name ASC"; // Default sort
    }

    connection = await mysql.createConnection(dbConfig);

    //   database connection
    console.log("Database connected successfully!");

    const [rows] = await connection.execute(sql + orderClause, params);

    res.json(rows);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

/**
 * GET /countries/:name: Get one country by name. (MOVED DOWN)
 * This must be defined last among all /countries/* routes!
 */
app.get("/countries/:name", async (req, res) => {
  let connection;
  try {
    const countryName = req.params.name;
    const sql = "SELECT * FROM country_cache WHERE name = ?";

    connection = await mysql.createConnection(dbConfig);
    //   database connection
    console.log("Database connected successfully!");

    const [rows] = await connection.execute(sql, [countryName]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

/**
 * DELETE /countries/:name: Delete a country record.
 */
app.delete("/countries/:name", async (req, res) => {
  let connection;
  try {
    const countryName = req.params.name;
    const sql = "DELETE FROM country_cache WHERE name = ?";

    connection = await mysql.createConnection(dbConfig);
    //   database connection
    console.log("Database connected successfully!");

    const [result] = await connection.execute(sql, [countryName]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Country not found" });
    }

    res
      .status(200)
      .json({ message: `Country ${countryName} deleted successfully.` });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

/**
 * GET /status: Show total countries and last refresh timestamp.
 */
app.get("/status", async (req, res) => {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    //   database connection
    console.log("Database connected successfully!");

    const [rows] = await connection.execute(
      "SELECT * FROM api_status WHERE id = 1"
    );

    const status = rows[0] || {};

    res.json({
      total_countries: parseInt(status.total_countries || "0", 10),
      last_refreshed_at: status.last_refreshed_at || null,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  } finally {
    if (connection) await connection.end();
  }
});

// Start server
app.listen(PORT, () => console.log(`Server running on PORT: ${PORT}`));
