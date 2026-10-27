import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('campusswap_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear stale token and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('campusswap_token');
      localStorage.removeItem('campusswap_user');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login?session=expired';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (data) => api.post('/auth/register', data),
  verifyEmail: (data) => api.post('/auth/verify-email', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// ── Categories ────────────────────────────────────────────────────────────────
export const categoriesApi = {
  list: () => api.get('/categories'),
};

// ── Listings ──────────────────────────────────────────────────────────────────
export const listingsApi = {
  search: (params) => api.get('/listings', { params }),
  get: (id) => api.get(`/listings/${id}`),
  create: (data) => api.post('/listings', data),
  update: (id, data) => api.put(`/listings/${id}`, data),
  remove: (id) => api.delete(`/listings/${id}`),
  claim: (id, data) => api.post(`/listings/${id}/claim`, data),
  getOffers: (id) => api.get(`/listings/${id}/offers`),
  createOffer: (id, data) => api.post(`/listings/${id}/offers`, data),
  createBarter: (id, data) => api.post(`/listings/${id}/barter-proposals`, data),
};

// ── Offers ────────────────────────────────────────────────────────────────────
export const offersApi = {
  counter: (id, data) => api.post(`/offers/${id}/counter`, data),
  accept: (id) => api.patch(`/offers/${id}/accept`),
  reject: (id) => api.patch(`/offers/${id}/reject`),
  withdraw: (id) => api.patch(`/offers/${id}/withdraw`),
  getMessages: (id, params) => api.get(`/offers/${id}/messages`, { params }),
  sendMessage: (id, data) => api.post(`/offers/${id}/messages`, data),
};

// ── Transactions ──────────────────────────────────────────────────────────────
export const transactionsApi = {
  list: (params) => api.get('/transactions', { params }),
  get: (id) => api.get(`/transactions/${id}`),
  complete: (id) => api.post(`/transactions/${id}/complete`),
  cancel: (id) => api.post(`/transactions/${id}/cancel`),
};

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviewsApi = {
  submit: (data) => api.post('/reviews', data),
  list: (params) => api.get('/reviews', { params }),
};

// ── Messages ──────────────────────────────────────────────────────────────────
export const messagesApi = {
  conversations: () => api.get('/messages'),
  thread: (id, params) => {
    if (params?.transactionId || params?.offerId) {
      return api.get('/messages', { params });
    }
    if (id) {
      return api.get(`/messages/${id}`, { params });
    }
    return api.get('/messages', { params });
  },
  send: (id, data, params) => {
    if (params?.transactionId || data?.transactionId || params?.offerId || data?.offerId) {
      return api.post('/messages', data, { params });
    }
    if (id) {
      return api.post(`/messages/${id}`, data);
    }
    return api.post('/messages', data);
  },
};

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminApi = {
  getReports: (params) => api.get('/admin/reports', { params }),
  resolveReport: (id, data) => api.patch(`/admin/reports/${id}`, data),
  takedownListing: (id) => api.patch(`/admin/listings/${id}/takedown`),
  suspendUser: (id, data) => api.patch(`/admin/users/${id}/suspend`, data),
};

// ── Reports ───────────────────────────────────────────────────────────────────
export const reportsApi = {
  file: (data) => api.post('/reports', data),
};

// ── Wishlist ──────────────────────────────────────────────────────────────────
export const wishlistApi = {
  list: () => api.get('/wishlists'),
  add: (data) => api.post('/wishlists', data),
  remove: (listingId) => api.delete(`/wishlists/${listingId}`),
};
