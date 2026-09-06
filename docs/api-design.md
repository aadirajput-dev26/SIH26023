# API Design

## 1. Folder & Collection Management

- **`POST /api/folders`**
  - **Description**: Creates a new folder. Internally creates a new collection in the Hippocampus RAG service and stores the mapping in MongoDB.
  - **Request**: `{ "name": "MP coal min FY 23-24", "description": "..." }`
  - **Response**: `{ "folderId": "123", "collectionId": "abc" }`

- **`GET /api/folders`**
  - **Description**: Retrieves a list of all folders along with their high-level dashboard analytics (extracted asynchronously during document processing).

- **`GET /api/folders/:id`**
  - **Description**: Retrieves details for a specific folder, including the list of processed documents, and the extracted JSON metrics for the dashboard.

## 2. Document Processing

- **`POST /api/folders/:id/upload`**
  - **Description**: Uploads massive files (PDFs, Images, DOCX, XLSX). 
  - **Action**: Uses Multer to accept files. Immediately dispatches a job to the `document-processing-queue`.
  - **Response**: `{ "jobId": "job_987", "status": "pending" }`

- **`GET /api/jobs/:id`**
  - **Description**: Polling endpoint for the frontend to check the status of any background job (Document Processing or Report Generation).
  - **Response**: `{ "status": "completed|processing|failed", "progress": 100, "result": { ... } }`

## 3. Report Generation

- **`POST /api/reports/generate`**
  - **Description**: Triggers the generation of a comprehensive report using LangChain Map-Reduce and GTWY inference.
  - **Request**: `{ "folderId": "123", "prompt": "Generate a summary of..." }`
  - **Response**: `{ "jobId": "job_456" }`

- **`GET /api/folders/:id/reports`**
  - **Description**: Retrieves all generated reports for a specific folder.

## 4. Chatbot Assistant

- **`POST /api/chat`**
  - **Description**: Sends a user query to the Hippocampus RAG backend for a specific folder.
  - **Request**: `{ "folderId": "123", "message": "What is the production figure?" }`
  - **Response**: `{ "answer": "...", "sources": [...] }`
