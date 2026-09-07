import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const HIPPOCAMPUS_URL = process.env.HIPPOCAMPUS_HOST_URL;
const API_KEY = process.env.HIPPOCAMPUS_API_KEY;

const axiosInstance = axios.create({
  baseURL: HIPPOCAMPUS_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
});

export const createCollection = async (name: string) => {
  const response = await axiosInstance.post('/collection', {
    name,
    settings: {
      denseModel: "text-embedding-3-large",
      sparseModel: "Qdrant/bm25",
      rerankerModel: "jinaai/jina-colbert-v2",
      chunkSize: 700,
      chunkOverlap: 100
    }
  });
  return response.data;
};

export const queryCollection = async (collectionId: string, query: string) => {
  const response = await axiosInstance.post(`/collection/${collectionId}/query`, {
    query
  });
  return response.data;
};
