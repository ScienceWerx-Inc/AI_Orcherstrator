import { PipeTransform } from "@nestjs/common";
import type { ZodTypeAny, z } from "zod";

/** Validates and strips request bodies using the shared contracts schemas. */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return this.schema.parse(value);
  }
}

export const zodPipe = <T extends ZodTypeAny>(schema: T): ZodValidationPipe<T> =>
  new ZodValidationPipe(schema);
