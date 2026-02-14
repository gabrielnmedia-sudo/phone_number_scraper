/**
 * Global Request Limiter for ScraperAPI
 * Enforces a maximum of 20 concurrent requests across all scrapers
 */

class RequestLimiter {
    constructor(maxConcurrent = 20) {
        this.maxConcurrent = maxConcurrent;
        this.active = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.active < this.maxConcurrent) {
            this.active++;
            return;
        }
        // Wait in queue until a slot opens
        return new Promise(resolve => {
            this.queue.push(resolve);
        });
    }

    release() {
        this.active--;
        if (this.queue.length > 0) {
            this.active++;
            const next = this.queue.shift();
            next();
        }
    }

    async run(fn) {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    get stats() {
        return { active: this.active, queued: this.queue.length };
    }
}

// Singleton - shared across all scrapers
const globalLimiter = new RequestLimiter(20);

module.exports = { globalLimiter, RequestLimiter };
