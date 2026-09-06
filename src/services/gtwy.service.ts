import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const GTWY_API_KEY = process.env.GTWY_API_KEY;

export const processImage = async (filePath: string) => {
  const formData = new FormData();
  formData.append('image', fs.createReadStream(filePath));

  const response = await axios.post('https://api.gtwy.ai/image/processing/', formData, {
    headers: {
      ...formData.getHeaders(),
      'authorization': GTWY_API_KEY,
    }
  });
  return response.data;
};

export const processPDF = async (filePath: string) => {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  const response = await axios.post('https://api.gtwy.ai/image/processing/upload', formData, {
    headers: {
      ...formData.getHeaders(),
      'authorization': GTWY_API_KEY,
    }
  });
  return response.data;
};
