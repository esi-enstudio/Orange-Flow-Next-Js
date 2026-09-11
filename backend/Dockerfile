# Base image with Python
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Debian trixie-updates rollout can carry a signature that apt rejects
# ("Not live until ...") on some dates. Exclude that suite so apt works reliably.
RUN cat > /etc/apt/sources.list.d/debian.sources <<EOF
Types: deb
URIs: http://deb.debian.org/debian
Suites: trixie
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp

Types: deb
URIs: http://deb.debian.org/debian-security
Suites: trixie-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp
EOF

# Install system dependencies for Playwright and PostgreSQL
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    libpq-dev \
    gcc \
    postgresql-client \
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
