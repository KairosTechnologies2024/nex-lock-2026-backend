const { Pool } = require('pg');
require('dotenv').config();

class OldEkcoAppDatabaseNotificationService {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.init();
  }

  async init() {
    try {
      const client = await this.pool.connect();
      console.log('✅ PostgreSQL connected successfully');
      client.release();
    } catch (error) {
      console.error('❌ PostgreSQL connection failed:', error.message);
    }
  }

  // Save FCM token
  async saveFCMToken(userId, token) {
    const query = `
      INSERT INTO ekco_old_app_fcm_tokens (user_id, token)
      VALUES ($1, $2)
      ON CONFLICT (token) 
      DO UPDATE SET 
        user_id = EXCLUDED.user_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const values = [userId, token];
    
    try {
      const result = await this.pool.query(query, values);
      console.log(`✅ FCM token saved for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error saving FCM token:', error);
      throw error;
    }
  }

  // Get FCM tokens by user ID
  async getFCMTokensByUserId(userId) {
    const query = `
      SELECT * FROM ekco_old_app_fcm_tokens 
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `;
    
    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  // Remove FCM token
  async removeFCMToken(token) {
    const query = `
      DELETE FROM ekco_old_app_fcm_tokens 
      WHERE token = $1
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [token]);
    return result.rows[0];
  }

  // Remove all tokens for a user
  async removeAllUserTokens(userId) {
    const query = `
      DELETE FROM ekco_old_app_fcm_tokens 
      WHERE user_id = $1
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  // Health check
  async healthCheck() {
    try {
      const result = await this.pool.query('SELECT NOW() as current_time');
      return {
        status: 'healthy',
        database: 'connected',
        timestamp: result.rows[0].current_time
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        database: 'disconnected',
        error: error.message
      };
    }
  }

  // Save Pushy token
  async savePushyToken(userId, token) {
    const query = `
      INSERT INTO ekco_old_app_pushy_tokens (user_id, token)
      VALUES ($1, $2)
      ON CONFLICT (token)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [userId, token];

    try {
      const result = await this.pool.query(query, values);
      console.log(`✅ Pushy token saved for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error saving Pushy token:', error);
      throw error;
    }
  }

  // Get Pushy tokens by user ID
  async getPushyTokensByUserId(userId) {
    const query = `
      SELECT * FROM ekco_old_app_pushy_tokens
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  // Remove Pushy token
  async removePushyToken(token) {
    const query = `
      DELETE FROM ekco_old_app_pushy_tokens
      WHERE token = $1
      RETURNING *
    `;

    const result = await this.pool.query(query, [token]);
    return result.rows[0];
  }

  // Remove all Pushy tokens for a user
  async removeAllUserPushyTokens(userId) {
    const query = `
      DELETE FROM ekco_old_app_pushy_tokens
      WHERE user_id = $1
      RETURNING *
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }

  // Get all notification tokens (FCM + Pushy) by user ID
  async getAllTokensByUserId(userId) {
    const fcmQuery = `
      SELECT token, 'fcm' as type FROM ekco_old_app_fcm_tokens
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `;

    const pushyQuery = `
      SELECT token, 'pushy' as type FROM ekco_old_app_pushy_tokens
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `;

    const [fcmResult, pushyResult] = await Promise.all([
      this.pool.query(fcmQuery, [userId]),
      this.pool.query(pushyQuery, [userId])
    ]);

    return [...fcmResult.rows, ...pushyResult.rows];
  }
}

module.exports = new OldEkcoAppDatabaseNotificationService();
