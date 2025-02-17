# 🎧 ReadrAI Backend

[![NestJS](https://img.shields.io/badge/NESTJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![MongoDB](https://img.shields.io/badge/MONGODB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Azure](https://img.shields.io/badge/AZURE-0078D4?style=for-the-badge&logo=microsoftazure&logoColor=white)](https://azure.microsoft.com/)
[![Socket.IO](https://img.shields.io/badge/SOCKET.IO-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://socket.io/)
[![PlayHT](https://img.shields.io/badge/PLAYHT-FF0000?style=for-the-badge&logo=audiomack&logoColor=white)](https://play.ht/)
[![TypeScript](https://img.shields.io/badge/TYPESCRIPT-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Live Website: https://readr-dsecdyb7ghgbbpbt.eastus2-01.azurewebsites.net  
Demo Video: https://streamable.com/3yamep

The backend service for ReadrAI, built with NestJS and MongoDB. Handles PDF processing, audio generation, and real-time updates.

## Project Team

- **Developer**: [Sohan Show](https://www.linkedin.com/in/sohanshow/)

- **Project Guidance**:
  - [Mahmoud Felfel](https://www.linkedin.com/in/mahmoud-felfel-33024252/)
  - [Noah Leshan](https://www.linkedin.com/in/noah-leshan/)

## 🛠️ Tech Stack

- NestJS framework
- MongoDB with Mongoose
- Socket.IO for real-time communication
- PlayHT API for AI voice generation
- Azure Blob Storage
- JWT Authentication
- Email service for OTP

## ⚙️ Prerequisites

- Node.js 16+
- MongoDB 4.4+
- Azure Account
- PlayHT API credentials
- SMTP service for emails

## 🚀 Installation

1. Clone the repository

```bash
git clone https://github.com/sohanshow/ReaderAI-Backend.git
```

2. Install dependencies

```bash
cd ReaderAI-Backend
npm install
```

3. Configure environment variables

```bash
cp .env.example .env
```

Required environment variables:

```env
MONGODB_URI=
JWT_SECRET=
ZOHO_MAIL=
ZOHO_PASSWORD=


PLAYHT_API_KEY=
PLAYHT_USER_ID=
PLAYHT_AGENT_ID=
PLAYHT_API_KEY_VOICE=

AZURE_CONTAINER_CONNECTION_STRING=
```

4. Start the development server

```bash
npm run start:debug
```

## 📁 Project Structure

```
src/
├── auth/           # Authentication module
├── files/          # PDF processing module
├── constants/      # To Store the available voices
├── config/         # Not used. But could be in future
├── gateway/        # WebSocket handlers
├── mail/           # Email service
├── services/       # PlayHT Services
├── user/           # User management
└── app.module.ts   # Main application module
```

## 🔌 API Endpoints

### Authentication

- POST `/auth/request-otp` - Request OTP for email
- POST `/auth/verify-otp` - Verify OTP and get JWT

### Files

- POST `/files/upload` - Upload PDF file
- GET `/files` - Get user's files
- GET `/files/:id` - Get specific file details
- DELETE `/files/:id` - Delete file and their corresponding data
- GET `/files/voices` - Get available voices

## 🔒 Security

- OTP-based authentication
- JWT token validation
- File size validation
- CORS configuration
- Rate limiting

## 💾 Database Schema

### User

```typescript
{
  email: string;
  lastLogin: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### File

```typescript
{
  userEmail: string;
  fileName: string;
  fileSize: number;
  uploadDate: Date;
  selectedVoice: string;
  filePath: string;
  pages: [{
    pageNumber: number;
    text: string;
    audioUrl: string;
    textExtractionStatus: string;
    audioGenerationStatus: string;
    error?: string;
  }];
  processingComplete: boolean;
  totalPages: number;
  processedPages: number;
}
```

## ⚡ WebSocket Events

### Emitted Events

- `pdf-progress-${userEmail}-${fileId}` - Processing progress updates
- `pdf-error-${userEmail}-${fileId}` - Error notifications

### Progress Event Structure

```typescript
{
  phase: 'extraction' | 'audio';
  current: number;
  total: number;
  pageNumber?: number;
}
```

## 🌐 Deployment

Deployed on Azure Cloud using:

- Azure Container Registry
- Azure App Service
- Azure Blob Storage
- MongoDB Atlas
