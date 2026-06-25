# Ticket Classifier Service

## Overview
The Ticket Classifier is a specialized web service designed to automate the triage of customer support messages in a busy digital finance environment. By analyzing a customer's free-text message, the service rapidly determines the nature of the issue, its severity, and the appropriate department for routing. It also flags critical issues or potential phishing attempts for immediate human review.

The backend leverages the Groq API and LLM inference for high-speed, accurate classification, ensuring that responses are generated well within a 30-second window.

## Architecture
This project is built using a modular Node.js architecture:
- **`server.js`**: The main entry point configuring the Express application.
- **`routes/index.js`**: Defines the API endpoints.
- **`services/classifier.js`**: Contains the core LLM integration and business logic for ticket classification.
- **`public/index.html`**: A decoupled, statically served test console for evaluating the API without requiring external API clients.

## Features
- Analyzes unstructured text to categorize tickets into specific types (e.g., wrong transfer, payment failed, refund request, phishing).
- Assigns severity levels (low, medium, high, critical).
- Routes tickets to the appropriate department.
- Generates a concise, neutral agent summary.
- Enforces safety protocols to never request sensitive information (PINs, OTPs, full card numbers).
- Identifies and flags critical severity and phishing cases for human review.

## Requirements
- Node.js (v18 or higher recommended)
- Groq API Key

## Setup and Installation

1. **Clone or Navigate to the Project Directory**
   Ensure you are in the `ticket-classifier` directory.

2. **Install Dependencies**
   Run the following command to install the required Node modules:
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the root of the project directory with the following variables:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   PORT=3000
   ```
   Note: Replace `your_groq_api_key_here` with your actual Groq API key.

## Running the Service

You can start the server in two modes:

- **Standard Mode:**
  ```bash
  npm start
  ```

- **Development Mode** (auto-restarts on file changes):
  ```bash
  npm run dev
  ```

The server will start on the port defined in your `.env` file (default is 3000).

## Testing

A built-in test console is included. Once the server is running, open a web browser and navigate to:
`http://localhost:3000` (or the port you configured). 

This interface allows you to submit test cases and view the structured JSON responses directly.

## API Documentation

### 1. Health Check
- **Method:** `GET`
- **Path:** `/health`
- **Purpose:** Verifies that the service is running.
- **Response:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-06-25T16:00:00.000Z"
  }
  ```

### 2. Sort Ticket
- **Method:** `POST`
- **Path:** `/sort-ticket`
- **Purpose:** Accepts a CRM ticket and returns a structured classification.
- **Headers:** `Content-Type: application/json`

#### Request Schema
```json
{
  "ticket_id": "T-001",
  "channel": "app",
  "locale": "en",
  "message": "I sent 5000 to a wrong number this morning, please help me get it back"
}
```
*Note: `channel` and `locale` are optional. `ticket_id` and `message` are required.*

#### Response Schema
```json
{
  "ticket_id": "T-001",
  "case_type": "wrong_transfer",
  "severity": "high",
  "department": "dispute_resolution",
  "agent_summary": "Customer reports sending 5000 to a wrong number and requests recovery.",
  "human_review_required": false,
  "confidence": 0.95
}
```

## Enums and Mappings

### Case Types
- `wrong_transfer`: Money sent to the wrong recipient.
- `payment_failed`: Transaction failed but balance may be deducted.
- `refund_request`: Customer is asking for a refund.
- `phishing_or_social_engineering`: Suspicious requests involving PINs, OTPs, or passwords.
- `other`: Issues not covered above.

### Departments
- `customer_support`
- `dispute_resolution`
- `payments_ops`
- `fraud_risk`

### Severities
- `low`, `medium`, `high`, `critical`

## Security and Constraints
- **Data Privacy:** The service explicitly forbids requesting or storing PINs, OTPs, passwords, or full card numbers in summaries.
- **Secrets Management:** API keys are never hardcoded and must be provided via the environment variables.
