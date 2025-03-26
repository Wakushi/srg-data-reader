import { Inject, Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Collection } from './entities/collections.type';
import { ONE_HOUR_IN_SECOND } from 'shared/constants';
import { Srg20HourlyPrice } from 'src/token/entities/token.types';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);

  private _client: SupabaseClient<any, 'public', any>;

  private readonly BATCH_SIZE = 100;

  constructor(
    @Inject('SUPABASE_CONFIG')
    private readonly config: { privateKey: string; url: string },
  ) {
    const { privateKey, url } = config;

    if (!privateKey) throw new Error(`Expected env var SUPABASE_API_KEY`);
    if (!url) throw new Error(`Expected env var SUPABASE_URL`);

    this._client = createClient(url, privateKey);
  }

  private get client(): SupabaseClient<any, 'public', any> {
    return this._client;
  }

  public async getTokenHistory(contract: string): Promise<Srg20HourlyPrice[]> {
    try {
      const { data, error } = await this.client
        .from(Collection.TOKEN_PRICE_HISTORY)
        .select('*')
        .eq('token_address', contract);

      if (error) throw error;

      if (!data?.length) {
        return [];
      }

      return data as Srg20HourlyPrice[];
    } catch (error) {
      this.logger.error('Error in getTokenHistory:', error);
      return [];
    }
  }

  public async getByTimestamp<T extends object>(
    collection: Collection,
    timestamp: number,
  ): Promise<T | null> {
    try {
      const prior = timestamp - ONE_HOUR_IN_SECOND / 2;
      const after = timestamp + ONE_HOUR_IN_SECOND / 2;

      const { data, error } = await this.client
        .from(collection)
        .select('*')
        .gt('timestamp', prior)
        .lt('timestamp', after)
        .limit(1);

      if (error) throw error;

      if (!data?.length) {
        return null;
      }

      return data[0] as T;
    } catch (error) {
      this.logger.error('Error in getByTimestampSingleQuery:', error);
      return null;
    }
  }

  public async getAll<T extends object>(collection: Collection): Promise<T[]> {
    try {
      const { data, error } = await this.client.from(collection).select('*');

      if (error) {
        throw new SupabaseError(
          `Failed to fetch data from ${collection}: ${error.message}`,
          error,
        );
      }

      return data as T[];
    } catch (error) {
      this.logger.error(`Error fetching data from ${collection}:`, error);
      throw error;
    }
  }

  public async batchUpsert<T extends object>({
    collection,
    items,
    options = {},
  }: {
    collection: Collection;
    items: T[];
    options: {
      batchSize?: number;
      progressLabel?: string;
      onConflict?: string;
      ignoreDuplicates?: boolean;
    };
  }): Promise<T[]> {
    const { batchSize = this.BATCH_SIZE, progressLabel = 'items' } = options;
    const allInsertedData: T[] = [];

    try {
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const currentBatch = i / batchSize + 1;
        const totalBatches = Math.ceil(items.length / batchSize);

        this.logger.log(
          `Inserting ${progressLabel} batch ${currentBatch} of ${totalBatches}`,
        );

        const { data, error } = await this.client
          .from(collection)
          .upsert(batch)
          .select();

        if (error) {
          throw new SupabaseError(
            `Failed to insert batch in ${collection}: ${error.message}`,
            error,
          );
        }

        allInsertedData.push(...data);
      }

      return allInsertedData;
    } catch (error) {
      this.logger.error(`Error in batch insert for ${collection}:`, error);
      throw error;
    }
  }

  public async insertSingle<T extends object>(
    collection: Collection,
    item: Omit<T, 'id'>,
  ): Promise<T> {
    try {
      const { data, error } = await this.client
        .from(collection)
        .insert(item)
        .select()
        .single();

      if (error) {
        throw new SupabaseError(
          `Failed to insert item in ${collection}: ${error.message}`,
          error,
        );
      }

      return data;
    } catch (error) {
      this.logger.error(`Error inserting single item in ${collection}:`, error);
      throw error;
    }
  }
}

export class SupabaseError extends Error {
  constructor(
    message: string,
    public readonly errorData?: any,
  ) {
    super(message);
    this.name = 'SupabaseError';
  }
}
