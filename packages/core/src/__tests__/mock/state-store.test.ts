import { describe, it, expect, beforeEach } from 'vitest';
import { StateStore } from '../../mock/state-store.js';

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  it('should set and get a value', () => {
    store.set('stripe', 'pi_abc123', { amount: 5000, status: 'created' });
    const result = store.get('stripe', 'pi_abc123');
    expect(result).toEqual({ amount: 5000, status: 'created' });
  });

  it('should return undefined for missing key', () => {
    expect(store.get('stripe', 'nonexistent')).toBeUndefined();
  });

  it('should return undefined for missing namespace', () => {
    expect(store.get('nonexistent', 'key')).toBeUndefined();
  });

  it('should list all values in a namespace', () => {
    store.set('users', 'u1', { name: 'Alice' });
    store.set('users', 'u2', { name: 'Bob' });
    const list = store.list('users');
    expect(list).toHaveLength(2);
    expect(list).toContainEqual({ name: 'Alice' });
    expect(list).toContainEqual({ name: 'Bob' });
  });

  it('should return empty array for missing namespace list', () => {
    expect(store.list('empty')).toEqual([]);
  });

  it('should update an existing resource with shallow merge', () => {
    store.set('stripe', 'pi_abc', { amount: 5000, status: 'created' });
    store.update('stripe', 'pi_abc', { status: 'succeeded' });
    expect(store.get('stripe', 'pi_abc')).toEqual({
      amount: 5000,
      status: 'succeeded',
    });
  });

  it('should not create a resource on update if it does not exist', () => {
    store.update('stripe', 'nonexistent', { status: 'failed' });
    expect(store.get('stripe', 'nonexistent')).toBeUndefined();
  });

  it('should delete a resource', () => {
    store.set('stripe', 'pi_abc', { amount: 1000 });
    const deleted = store.delete('stripe', 'pi_abc');
    expect(deleted).toBe(true);
    expect(store.get('stripe', 'pi_abc')).toBeUndefined();
  });

  it('should return false when deleting nonexistent resource', () => {
    expect(store.delete('stripe', 'nonexistent')).toBe(false);
  });

  it('should clear all state', () => {
    store.set('stripe', 'pi_1', { amount: 100 });
    store.set('users', 'u_1', { name: 'Test' });
    store.clear();
    expect(store.list('stripe')).toEqual([]);
    expect(store.list('users')).toEqual([]);
  });

  it('should support typed get', () => {
    interface PaymentIntent {
      amount: number;
      status: string;
    }
    store.set('stripe', 'pi_typed', { amount: 2000, status: 'pending' });
    const result = store.get<PaymentIntent>('stripe', 'pi_typed');
    expect(result?.amount).toBe(2000);
    expect(result?.status).toBe('pending');
  });

  it('should isolate namespaces', () => {
    store.set('ns1', 'key', { value: 'one' });
    store.set('ns2', 'key', { value: 'two' });
    expect(store.get('ns1', 'key')).toEqual({ value: 'one' });
    expect(store.get('ns2', 'key')).toEqual({ value: 'two' });
  });
});
