"use client";

import { PAGE_SIZE_OPTIONS, type ListPagination } from "@/components/control-panel-client";

type PaginationControlsProps = {
  pagination: ListPagination;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function PaginationControls({
  pagination,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  return (
    <div className="pagination-bar">
      <div className="pagination-meta">
        <label className="pagination-size">
          <span>Page size</span>
          <select
            value={pagination.pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {pagination.total} total
        </span>
      </div>

      <div className="pagination-actions">
        <span className="muted">
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <button
          className="button secondary"
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          Previous
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
