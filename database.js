// database.js
const Pool = require('pg').Pool;
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
    accessKeyId: 'AKIAVMN4RQF2CYYPD56E',
    secretAccessKey: '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', 
    region: 'ap-south-1', 
  });

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'project',
    password: 'Vansh@123',
    port: 5433
});

module.exports = { pool, s3 };
