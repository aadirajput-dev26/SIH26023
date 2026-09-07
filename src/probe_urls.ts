import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.GTWY_API_KEY;

async function probe() {
  const hosts = [
    'https://api.gtwy.ai',
    'https://db.gtwy.ai',
  ];
  
  const paths = [
    '/api/rag/resource',
    '/api/v1/rag/resource',
    '/api/v2/rag/resource',
    '/rag/resource',
    '/api/resource',
    '/resource',
  ];

  for (const host of hosts) {
    for (const p of paths) {
      const url = `${host}${p}`;
      try {
        const res = await axios.get(url, {
          headers: {
            'pauthkey': API_KEY,
            'Accept': 'application/json, text/plain, */*'
          },
          timeout: 5000
        });
        console.log(`[SUCCESS] GET ${url} -> ${res.status}`);
      } catch (e: any) {
        console.log(`[FAILED] GET ${url} -> ${e.response?.status || e.code || e.message}`);
      }
    }
  }
}

probe();
