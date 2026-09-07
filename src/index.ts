import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

import routes from './routes';
import './workers/document.worker';
import './workers/report.worker';

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api', routes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running' });
});

connectDB().then(() => {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}).catch((error: any) => {
  console.error('Failed to start server:', error);
});
