import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { transactionsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const STATUS_CONFIG = {
  PENDING_MEETUP: { label: '🤝 Meetup Pending', badge: 'bg-warning text-dark' },
  COMPLETED: { label: '✅ Completed', badge: 'bg-success' },
  CANCELLED: { label: '✕ Cancelled', badge: 'bg-danger' },
};

const TYPE_CONFIG = {
  SALE: { label: '💰 Sale', badge: 'mode-SELL' },
  BARTER: { label: '🔄 Barter', badge: 'mode-BARTER' },
  FREE_GIVEAWAY: { label: '🎁 Free Giveaway', badge: 'mode-FREE' },
};

export default function TransactionsPage() {
  const { user } = useAuth();

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('all');

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (roleFilter !== 'all') params.role = roleFilter;

      const res = await transactionsApi.list(params);
      setTransactions(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load transaction history.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, roleFilter]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const getStatusCount = (statusKey) => {
    if (statusKey === 'ALL') return transactions.length;
    return transactions.filter((t) => t.status === statusKey).length;
  };

  const formatPrice = (tx) => {
    if (tx.transactionType === 'FREE_GIVEAWAY') {
      return <span style={{ color: 'var(--cs-success)', fontWeight: 700 }}>FREE</span>;
    }
    if (tx.transactionType === 'BARTER') {
      const diff = parseFloat(tx.finalPrice || 0);
      return (
        <span style={{ color: '#fcd34d', fontWeight: 700 }}>
          BARTER {diff > 0 ? `(+₹${diff.toFixed(0)})` : '(Even Trade)'}
        </span>
      );
    }
    return <span className="price-tag">₹{parseFloat(tx.finalPrice || 0).toFixed(0)}</span>;
  };

  return (
    <div className="container py-4 fade-in-up" style={{ maxWidth: 960 }}>
      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.8rem', color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
            Transactions &amp; Meetups
          </h1>
          <p className="text-muted-cs mb-0" style={{ fontSize: '0.9rem' }}>
            Coordinate in-person campus handovers, confirm completed exchanges, and view transaction receipts.
          </p>
        </div>

        <Link to="/listings" className="btn btn-outline-secondary btn-sm">
          Browse Marketplace
        </Link>
      </div>

      {error && (
        <div className="alert alert-danger py-2 mb-4" role="alert">
          {error}
        </div>
      )}

      {/* Filters: Status & Role */}
      <div className="card p-3 mb-4">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
          {/* Status filter tabs */}
          <div className="d-flex gap-2 overflow-auto pb-1">
            {[
              { key: 'ALL', label: 'All' },
              { key: 'PENDING_MEETUP', label: 'Meetups Pending' },
              { key: 'COMPLETED', label: 'Completed' },
              { key: 'CANCELLED', label: 'Cancelled' },
            ].map((tab) => {
              const isActive = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline-secondary'}`}
                  style={{ borderRadius: '20px', padding: '0.35rem 0.9rem', fontSize: '0.82rem', fontWeight: 600 }}
                  onClick={() => setStatusFilter(tab.key)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Role selector dropdown */}
          <div className="d-flex align-items-center gap-2">
            <span className="text-dim" style={{ fontSize: '0.82rem' }}>
              My Role:
            </span>
            <select
              className="form-select form-select-sm"
              style={{ width: 'auto', fontSize: '0.82rem' }}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="all">All Roles</option>
              <option value="seller">As Seller</option>
              <option value="buyer">As Buyer</option>
            </select>
          </div>
        </div>
      </div>

      {/* Transactions List */}
      {loading ? (
        <Spinner text="Loading transactions…" />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon="🤝"
          title="No transactions found"
          message={
            statusFilter === 'ALL' && roleFilter === 'all'
              ? 'You have not participated in any accepted offers, barter agreements, or giveaways yet.'
              : 'No transactions match the selected filters.'
          }
        >
          <Link to="/listings" className="btn btn-primary mt-2">
            Explore Campus Marketplace
          </Link>
        </EmptyState>
      ) : (
        <div className="d-flex flex-column gap-3">
          {transactions.map((tx) => {
            const statusInfo = STATUS_CONFIG[tx.status] || { label: tx.status, badge: 'bg-secondary' };
            const typeInfo = TYPE_CONFIG[tx.transactionType] || { label: tx.transactionType, badge: 'bg-secondary' };
            const isPending = tx.status === 'PENDING_MEETUP';

            return (
              <div
                key={tx.id}
                className="card p-3 p-md-4"
                style={{
                  borderLeft: isPending ? '4px solid var(--cs-warning)' : undefined,
                }}
              >
                <div className="row g-3 align-items-center">
                  {/* Left Column: Transaction Type Icon */}
                  <div className="col-auto">
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 'var(--cs-radius-sm)',
                        background: isPending ? 'rgba(245,158,11,0.15)' : 'var(--cs-surface2)',
                        border: '1px solid var(--cs-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.4rem',
                      }}
                    >
                      {tx.transactionType === 'FREE_GIVEAWAY' ? '🎁' : tx.transactionType === 'BARTER' ? '🔄' : '🤝'}
                    </div>
                  </div>

                  {/* Middle Column: Item and Counterparty info */}
                  <div className="col">
                    <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                      <span className={`badge ${statusInfo.badge}`}>{statusInfo.label}</span>
                      <span className={`badge ${typeInfo.badge}`}>{typeInfo.label}</span>
                      <span className="text-dim" style={{ fontSize: '0.78rem' }}>
                        Tx #{tx.id}
                      </span>
                    </div>

                    <h3
                      className="mb-1"
                      style={{
                        fontSize: '1.05rem',
                        fontWeight: 700,
                        color: 'var(--cs-text)',
                        lineHeight: 1.3,
                      }}
                    >
                      <Link to={`/transactions/${tx.id}`} className="text-decoration-none" style={{ color: 'var(--cs-text)' }}>
                        {tx.listing?.title}
                      </Link>
                    </h3>

                    <div className="d-flex align-items-center gap-3 flex-wrap mt-1">
                      <div>{formatPrice(tx)}</div>

                      {tx.counterparty && (
                        <div className="text-muted-cs" style={{ fontSize: '0.85rem' }}>
                          Counterparty: <strong style={{ color: 'var(--cs-text)' }}>{tx.counterparty.fullName}</strong>
                          {tx.counterparty.phoneNumber && (
                            <span className="text-dim ms-1">({tx.counterparty.phoneNumber})</span>
                          )}
                        </div>
                      )}

                      {tx.createdAt && (
                        <div className="text-dim" style={{ fontSize: '0.78rem' }}>
                          Initiated {new Date(tx.createdAt).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="col-12 col-md-auto d-flex align-items-center gap-2 justify-content-md-end flex-wrap">
                    <Link to={`/transactions/${tx.id}`} className="btn btn-primary btn-sm px-3">
                      {isPending ? '🤝 Handover Details' : 'View Receipt'}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
