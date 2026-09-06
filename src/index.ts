import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

import routes from './routes';

app.use(cors());
app.use(express.json());

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
