import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import DocumentModel from '../models/Document';
import FolderModel from '../models/Folder';
import { processImage, processPDF } from '../services/gtwy.service';
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

export const documentWorker = new Worker('document-processing-queue', async job => {
  const { documentId, folderId, filePath, fileType } = job.data;
  console.log(`Processing job ${job.id} for document ${documentId}`);

  try {
    // 1. Update Document Status
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'processing' });

    // 2. Format conversion if docx/xlsx (mocked for now, assumes PDF/Image)
    let processedResult;
    if (fileType.includes('image')) {
      processedResult = await processImage(filePath);
    } else {
      processedResult = await processPDF(filePath);
    }

    // 3. Extract analytics (Topic, Wordcloud, etc from GTWY output)
    const extractedText = processedResult.text || JSON.stringify(processedResult);

    // Use LangChain to dynamically extract random data / structure it for the dashboard
    const model = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0 });
    const analyticsSchema = z.object({
      topic: z.string().describe("The main topic of the document"),
      wordCloudKeywords: z.array(z.string()).describe("A list of top 20 significant keywords for a word cloud"),
      summary: z.string().describe("A brief summary of the document"),
      extractedMetrics: z.record(z.string(), z.any()).describe("Random numerical data or important entities extracted from the text")
    });

    const extractor = model.withStructuredOutput(analyticsSchema);
    console.log(`Extracting analytics via LangChain for job ${job.id}...`);
    
    // Pass up to 50k characters to avoid token limits on huge documents
    const analyticsData = await extractor.invoke(`Extract the requested analytics from the following document text:\n\n${extractedText.substring(0, 50000)}`);

    // 4. Update Folder Analytics
    await FolderModel.findByIdAndUpdate(folderId, {
      $set: {
        'analyticsMetrics.lastProcessed': new Date(),
      },
      // In a real app we'd merge the keywords and metrics carefully, 
      // here we append to an array of processed doc analytics for the dashboard
      $push: {
        'analyticsMetrics.documentsData': {
          documentId,
          ...analyticsData
        }
      }
    });

    // 5. Update Document Status
    await DocumentModel.findByIdAndUpdate(documentId, { 
      status: 'completed',
      hippocampusDocumentId: processedResult.id || 'mock-id'
    });

    return { success: true, documentId };
  } catch (error: any) {
    console.error(`Job ${job.id} failed:`, error.message);
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'failed' });
    throw error;
  }
}, { connection });

documentWorker.on('completed', job => {
  console.log(`Job ${job.id} has completed!`);
});

documentWorker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} has failed with ${err.message}`);
});
