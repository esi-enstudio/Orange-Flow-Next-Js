# Base image with Python
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for Playwright and PostgreSQL
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright and its browser dependencies
RUN playwright install --with-deps chromium

# Copy the rest of the application
COPY . .

# Expose port for webhook
EXPOSE 8090

# Command to run the bot
CMD ["python", "main.py"]
