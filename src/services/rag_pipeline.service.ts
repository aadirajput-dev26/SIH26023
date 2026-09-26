import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const RAG_URL = process.env.RAG_PIPELINE_URL || 'http://localhost:8000/api/v1';
const API_KEY = process.env.AI_SERVICE_API_KEY || 'default_key';

// Dummy UUIDs for tenant context since Express backend doesn't use them yet
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

const client = axios.create({
  baseURL: RAG_URL,
  headers: {
    'X-Api-Key': API_KEY,
  },
  timeout: 60000,
});

export const ingestDocument = async (filePath: string, filename: string, mimeType: string) => {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('org_id', DEFAULT_ORG_ID);
  formData.append('workspace_id', DEFAULT_WORKSPACE_ID);
  formData.append('uploaded_by_user_id', DEFAULT_USER_ID);
  formData.append('filename', filename);
  formData.append('declared_mime_type', mimeType);

  const response = await client.post('/documents/ingest', formData, {
    headers: formData.getHeaders(),
  });
  return response.data;
};

export const ingestUrl = async (url: string) => {
  const response = await client.post('/documents/ingest-url', {
    url,
    org_id: DEFAULT_ORG_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
    uploaded_by_user_id: DEFAULT_USER_ID,
  });
  return response.data;
};

export const checkDocumentStatus = async (documentId: string) => {
  const response = await client.get(`/documents/${documentId}/status`);
  return response.data;
};

export const queryPipeline = async (queryText: string, documentIds?: string[]) => {
  const response = await client.post('/query', {
    query_text: queryText,
    scope: {
      org_id: DEFAULT_ORG_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
      document_ids: documentIds,
    }
  });
  return response.data;
};
