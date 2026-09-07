import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GTWY_RAG_URL = 'https://db.gtwy.ai/api/rag';
const AUTH_TOKEN = process.env.GTWY_API_KEY; 

const ragClient = axios.create({
  baseURL: GTWY_RAG_URL,
  headers: {  
    'pauthkey': AUTH_TOKEN,
    'authorization': AUTH_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
  },
  timeout: 15000
});

// ─── Resource Types ────────────────────────────────────────────────────────────

interface ResourceSettings {
  strategy?: 'recursive' | 'sentence';
  chunkSize?: string;
}

interface CreateUrlResourcePayload {
  title: string;
  description?: string;
  settings?: ResourceSettings;
  url: string;
  collection_details?: string;
}

interface CreateContentResourcePayload {
  title: string;
  description?: string;
  settings?: ResourceSettings;
  content: string;
  collection_details?: string;
}

// ─── API Functions ─────────────────────────────────────────────────────────────

/**
 * Create a resource from a public URL (e.g. a PDF link from coal.gov.in)
 */
export const createUrlResource = async (payload: CreateUrlResourcePayload) => {
  try {
    const response = await ragClient.post('/resource', {
      title: payload.title,
      description: payload.description || payload.title,
      settings: payload.settings || { strategy: 'recursive', chunkSize: '1000' },
      url: payload.url,
      collection_details: payload.collection_details || 'fastest',
    });
    console.log('[GTWY RAG] URL Resource created:', response.data?._id);
    return response.data;
  } catch (error: any) {
    console.error('[GTWY RAG] createUrlResource error:', error.response?.status, error.response?.data || error.message);
    throw error;
  }
};

/**
 * Create a resource from raw text content
 */
export const createContentResource = async (payload: CreateContentResourcePayload) => {
  try {
    const response = await ragClient.post('/resource', {
      title: payload.title,
      description: payload.description || payload.title,
      settings: payload.settings || { strategy: 'recursive', chunkSize: '1000' },
      content: payload.content,
      collection_details: payload.collection_details || 'fastest',
    });
    console.log('[GTWY RAG] Content Resource created:', response.data?._id);
    return response.data;
  } catch (error: any) {
    console.error('[GTWY RAG] createContentResource error:', error.response?.status, error.response?.data || error.message);
    throw error;
  }
};

/**
 * Get all resources in the workspace
 */
export const getAllResources = async () => {
  try {
    const response = await ragClient.get('/resource');
    return response.data;
  } catch (error: any) {
    console.error('[GTWY RAG] getAllResources error:', error.response?.status, error.response?.data || error.message);
    throw error;
  }
};

/**
 * Delete a resource by its GTWY resource ID
 */
export const deleteResource = async (resourceId: string) => {
  try {
    const response = await ragClient.delete(`/resource/${resourceId}`);
    console.log('[GTWY RAG] Resource deleted:', resourceId);
    return response.data;
  } catch (error: any) {
    console.error('[GTWY RAG] deleteResource error:', error.response?.status, error.response?.data || error.message);
    throw error;
  }
};
