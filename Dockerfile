# Image Node resmi yang ramping
FROM node:20-alpine

# Direktori kerja di dalam container
WORKDIR /app

# Install dependency lebih dulu (manfaatkan cache layer Docker).
# Pakai npm ci jika ada package-lock.json, selain itu npm install.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Salin sisa kode aplikasi
COPY . .

# Jalankan sebagai user non-root bawaan image (keamanan)
USER node

# Port default; platform cloud akan menyuntikkan PORT lewat env
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
