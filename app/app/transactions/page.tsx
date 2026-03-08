import React from 'react';
import { useNLSearch } from '../../../hooks/useNLSearch';

const TransactionsPage = () => {
  const { transactions, nlAnswer, searchQuery, clearSearch } = useNLSearch();

  const renderEmptyState = () => {
    if (searchQuery && transactions.length === 0) {
      return (
        <div className="text-center py-12 text-gray-400 text-sm">
          <p>{nlAnswer || 'No transactions found'}</p>
          <p className="mt-4">Try a different search or <button onClick={clearSearch} className="text-blue-500">clear the search box</button>.</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      {/* Existing components and logic for rendering transactions */}
      {transactions.length === 0 && renderEmptyState()}
    </div>
  );
};

export default TransactionsPage;
