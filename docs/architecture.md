# System Architecture

## Background Workers (BullMQ + Redis)

We are using exactly two professional background queues to ensure the API remains fast and decoupled from heavy workloads.

### 1. `document-processing-queue`
- **Purpose**: Handles everything related to an uploaded document.
- **Workflow**:
  1. Converts DOCX/XLSX to PDF (using mammoth/puppeteer).
  2. Uploads the finalized PDF/Image to GTWY / Hippocampus APIs.
  3. Immediately runs analytics extraction (e.g., getting topics, word cloud data, extracting key JSON metrics) since the document context is fresh.
  4. Updates the MongoDB Folder document with the new analytics metrics so the frontend dashboard can render it.

### 2. `report-generation-queue`
- **Purpose**: Generates deep, professional, multi-page analytical reports spanning entire folders.
- **Workflow**:
  1. Orchestrated via **LangChain.js**.
  2. Uses Map-Reduce chains to pull large chunks of data from Hippocampus.
  3. Uses GTWY inference to generate professional analytical sections.
  4. Outputs a structured HTML/Markdown report string that the frontend can render into a precise template.

## Database (MongoDB)
- **Folder Collection**: Stores `_id`, `name`, `hippocampusCollectionId`, `analyticsMetrics` (JSON).
- **Document Collection**: Stores metadata for each uploaded file.
- **Report Collection**: Stores generated reports.
