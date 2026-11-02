import { BadRequestException } from "@nestjs/common";

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
}

export function parsePagination(query: Record<string, unknown>): PageParams {
  const rawPage = Number(query.page ?? 1);
  const rawLimit = Number(query.limit ?? 20);
  if (!Number.isFinite(rawPage) || rawPage < 1) {
    throw new BadRequestException("page must be a positive integer");
  }
  if (!Number.isFinite(rawLimit) || rawLimit < 1) {
    throw new BadRequestException("limit must be a positive integer");
  }
  const page = Math.floor(rawPage);
  const limit = Math.min(Math.floor(rawLimit), 100);
  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
