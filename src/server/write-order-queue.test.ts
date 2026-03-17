import { describe, it, expect } from 'vitest';
import { WriteOrderQueue } from './write-order-queue';

describe('WriteOrderQueue', () => {
  it('processes in-order enqueues immediately', () => {
    const queue = new WriteOrderQueue();
    const order: number[] = [];

    const seq1 = queue.reserve();
    const seq2 = queue.reserve();

    queue.enqueue(seq1, () => order.push(1));
    queue.enqueue(seq2, () => order.push(2));

    expect(order).toEqual([1, 2]);
    expect(queue.pendingCount).toBe(0);
  });

  it('holds out-of-order enqueue until earlier seq arrives', () => {
    const queue = new WriteOrderQueue();
    const order: number[] = [];

    const seq1 = queue.reserve();
    const seq2 = queue.reserve();

    // seq2 arrives first — should wait
    queue.enqueue(seq2, () => order.push(2));
    expect(order).toEqual([]);
    expect(queue.pendingCount).toBe(1);

    // seq1 arrives — both drain in order
    queue.enqueue(seq1, () => order.push(1));
    expect(order).toEqual([1, 2]);
    expect(queue.pendingCount).toBe(0);
  });

  it('skip unblocks subsequent writes', () => {
    const queue = new WriteOrderQueue();
    const order: number[] = [];

    const seq1 = queue.reserve();
    const seq2 = queue.reserve();

    queue.enqueue(seq2, () => order.push(2));
    expect(order).toEqual([]);

    // seq1 failed — skip it
    queue.skip(seq1);
    expect(order).toEqual([2]);
    expect(queue.pendingCount).toBe(0);
  });

  it('handles three writes with middle arriving last', () => {
    const queue = new WriteOrderQueue();
    const order: number[] = [];

    const seq1 = queue.reserve();
    const seq2 = queue.reserve();
    const seq3 = queue.reserve();

    queue.enqueue(seq1, () => order.push(1));
    expect(order).toEqual([1]);

    queue.enqueue(seq3, () => order.push(3));
    expect(order).toEqual([1]); // seq2 missing, seq3 waits

    queue.enqueue(seq2, () => order.push(2));
    expect(order).toEqual([1, 2, 3]);
  });

  it('skip in the middle unblocks the rest', () => {
    const queue = new WriteOrderQueue();
    const order: number[] = [];

    const seq1 = queue.reserve();
    const seq2 = queue.reserve();
    const seq3 = queue.reserve();

    queue.enqueue(seq3, () => order.push(3));
    queue.enqueue(seq1, () => order.push(1));
    expect(order).toEqual([1]); // seq2 missing

    queue.skip(seq2);
    expect(order).toEqual([1, 3]);
  });

  it('consecutive skips unblock everything', () => {
    const queue = new WriteOrderQueue();
    const order: number[] = [];

    const seq1 = queue.reserve();
    const seq2 = queue.reserve();
    const seq3 = queue.reserve();

    queue.enqueue(seq3, () => order.push(3));

    queue.skip(seq1);
    expect(order).toEqual([]); // seq2 still missing

    queue.skip(seq2);
    expect(order).toEqual([3]);
  });

  it('works across many sequential reserves', () => {
    const queue = new WriteOrderQueue();
    const order: number[] = [];

    const seqs: number[] = [];
    for (let i = 0; i < 10; i++) {
      seqs.push(queue.reserve());
    }

    // Enqueue in reverse order
    for (let i = seqs.length - 1; i >= 0; i--) {
      queue.enqueue(seqs[i], () => order.push(i));
    }

    // All should drain in original order (0..9)
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(queue.pendingCount).toBe(0);
  });
});
