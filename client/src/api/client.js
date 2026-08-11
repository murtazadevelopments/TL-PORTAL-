import axios from 'axios';

// Vite bakes VITE_* at build time. Paths below include `/api/...`.
const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_URL ||
    'https://mediumpurple-chicken-145151.hostingersite.com',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
