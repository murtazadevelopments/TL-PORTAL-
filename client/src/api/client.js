import axios from 'axios';

/**
 * Same-origin by default so production (Express + SPA on one Hostinger site)
 * calls /api/* on the current host. Override with VITE_API_URL only if the
 * API is on a different origin.
 */
const raw = import.meta.env.VITE_API_URL;
const baseURL =
  raw === undefined || raw === null || String(raw).trim() === ''
    ? ''
    : String(raw).trim().replace(/\/$/, '');

const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
