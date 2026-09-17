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

# Install system dependencies for Playwright and PostgreSQL 18 client
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Add official PostgreSQL APT repository (PGDG) for latest client tools
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg

RUN echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list

RUN apt-get update && apt-get install -y postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*

# Make PG 18 tools the default
RUN update-alternatives --install /usr/bin/pg_dump  pg_dump  /usr/lib/postgresql/18/bin/pg_dump  100 \
 && update-alternatives --install /usr/bin/pg_restore pg_restore /usr/lib/postgresql/18/bin/pg_restore 100 \
 && update-alternatives --install /usr/bin/psql      psql      /usr/lib/postgresql/18/bin/psql      100

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
