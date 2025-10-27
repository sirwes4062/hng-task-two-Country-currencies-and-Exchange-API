# 🌍 REST Countries API

A simple Node.js and Express server that fetches and serves data about countries using the [REST Countries API](https://restcountries.com/).

---

## 🚀 Features
- Fetches country data including:
  - Name
  - Capital
  - Region
  - Population
  - Flag
  - Currencies
- Uses Express for server setup
- Uses `axios` for making external API calls
- Lightweight and ready to be connected to a frontend

---

## 🧰 Technologies Used
- **Node.js**
- **Express.js**
- **Axios**

---

## ⚙️ Setup Instructions

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/your-username/rest-countries-api.git
```

### 2️⃣ Navigate to the Project Folder
```bash
cd rest-countries-api
```

### 3️⃣ Install Dependencies
```bash
npm install
```

### 4️⃣ Run the Server Locally
```bash
node index.js
```

The server will start at:
```
http://localhost:3000
```

---

## 🌐 Hosted Deployment
Once deployed (e.g., on **Railway**, **Render**, or **Vercel**), your live API will be accessible at:

```
https://your-project-name.up.railway.app/
```

Replace the above with your actual deployed link.

---

## 🧩 Example Endpoint

### GET `/countries`
Fetches a list of all countries with their names, capitals, regions, populations, flags, and currencies.

Example:
```
https://your-project-name.up.railway.app/countries
```

Response:
```json
[
  {
    "name": "Nigeria",
    "capital": "Abuja",
    "region": "Africa",
    "population": 206139589,
    "flag": "https://flagcdn.com/ng.svg",
    "currencies": [
      {
        "code": "NGN",
        "name": "Nigerian naira",
        "symbol": "₦"
      }
    ]
  }
]
```

---

## 📦 Environment Variables (Optional)
If you use environment variables (for API keys, ports, etc.), create a `.env` file in your root directory and add your keys like this:

```
PORT=3000
```

Then load it using:
```bash
npm install dotenv
```

And include this line at the top of your `index.js`:
```js
require('dotenv').config();
```

---

## 📄 License
This project is open source under the [MIT License](LICENSE).

---

## 👨‍💻 Author
**Salifu Williams Eneojo**  
- GitHub: [@your-username](https://github.com/sirwes4062/hng-task-two-Country-currencies-and-Exchange-API)  
- Email: williamseneojo@gmail.com

---

## 🧠 Next Steps
- Add search or filter endpoints
- Connect with a frontend (React, Next.js)
- Deploy frontend and backend together

---
