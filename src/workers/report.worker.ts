import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import FolderModel from '../models/Folder';
// In a real scenario, this would use LangChain's MapReduceDocumentsChain or similar
import { ChatOpenAI } from '@langchain/openai';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

export const reportWorker = new Worker('report-generation-queue', async job => {
  const { folderId, prompt } = job.data;
  console.log(`Starting report generation for folder ${folderId}`);

  try {
    const folder = await FolderModel.findById(folderId);
    if (!folder) throw new Error('Folder not found');

    // Use Langchain to generate a professional report using aggregated analytics
    console.log(`Executing LangChain report generation for folder ${folder.name}...`);
    
    const llm = new ChatOpenAI({ modelName: 'gpt-4o', temperature: 0.2 });
    const reportPrompt = `
      You are an expert mining and geological analyst for CMPDI/CIL.
      Generate a comprehensive, professional report based on the following aggregated document analytics.
      User Prompt/Focus: ${prompt}
      
      Folder Context & Analytics:
      ${JSON.stringify(folder.analyticsMetrics, null, 2)}
      
      Output the report in Markdown format with clear headings, an executive summary, and key findings.
    `;

    const response = await llm.invoke(reportPrompt);

    const generatedReport = {
      title: `Generated Report for ${folder.name}`,
      content: response.content,
      createdAt: new Date()
    };

    return { success: true, report: generatedReport };
  } catch (error: any) {
    console.error(`Report job failed:`, error.message);
    throw error;
  }
}, { connection });

reportWorker.on('completed', job => {
  console.log(`Report Job ${job.id} has completed!`);
});
