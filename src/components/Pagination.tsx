import { ChevronLeft, ChevronRight } from "lucide-react";
import "./Pagination.css";

export function paginationPages(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  return [...pages]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right)
    .reduce<(number | "ellipsis")[]>((result, page) => {
      const previous = result[result.length - 1];
      if (typeof previous === "number" && page - previous > 1)
        result.push("ellipsis");
      result.push(page);
      return result;
    }, []);
}

export function Pagination({
  page,
  total,
  pageSize = 20,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <nav className="pagination" aria-label="分页导航">
      <span className="pagination-total">共 {total} 条</span>
      <button
        type="button"
        className="icon-button"
        disabled={page === 1}
        aria-label="上一页"
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={17} />
      </button>
      <div className="pagination-pages">
        {paginationPages(page, totalPages).map((item, index) =>
          item === "ellipsis" ? (
            <span className="pagination-ellipsis" key={`ellipsis-${index}`}>
              ...
            </span>
          ) : (
            <button
              type="button"
              className={item === page ? "active" : ""}
              aria-current={item === page ? "page" : undefined}
              key={item}
              onClick={() => onChange(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>
      <button
        type="button"
        className="icon-button"
        disabled={page >= totalPages}
        aria-label="下一页"
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={17} />
      </button>
    </nav>
  );
}
