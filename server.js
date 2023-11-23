const express = require('express');
const bodyParser = require('body-parser');

const Pool  = require('pg').Pool

const app = express();
const port = 3000;

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const multer = require('multer');
const AWS = require('aws-sdk');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const { pool } = require('./database');
const { s3 } = require('./database');


const secretKey = 'secret key';



// Middleware
app.use(bodyParser.json());

// Register endpoint
app.post('/register', async (req, res) => {
   const { username, emailID, password } = req.body;

   const hashedPassword = await bcrypt.hash(password, 10);
  
    try {
      // Insert user into the database
      const result = await pool.query('INSERT INTO users (username, emailID ,password) VALUES ($1, $2 ,$3) RETURNING *', [username, emailID, hashedPassword]);
      
      res.json({ success: true, user: result.rows[0]});
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, emailID, password } = req.body;

  try {
    // Retrieve user from the database
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, message: 'Authentication failed. User not found.' });
      return;
    }

    // Compare the provided password with the hashed password from the database
    const passwordMatch = await bcrypt.compare(password, result.rows[0].password);
    console.log(passwordMatch);
    const IDMatch = emailID === result.rows[0].emailid;
    
    const token = jwt.sign({ userId: result.rows[0].username }, secretKey);
    

    if (passwordMatch && IDMatch) {
      res.json({ success: true, message: 'Authentication successful' ,token: token });
    } else {
      res.status(401).json({ success: false, message: ' Incorrect Email ID or password' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

app.post('/create-folder',authenticateToken, async (req, res) => {
    const { folderName } = req.body;
    const userId = req.user.userId; // Extracted from the token during authentication
  
    try {
      // Check if the folder name is unique for the user
      const checkResult = await pool.query('SELECT * FROM folders WHERE user_id = $1 AND folder_name = $2', [userId, folderName]);
  
      if (checkResult.rows.length > 0) {
        res.status(400).json({ success: false, message: 'Folder name must be unique for the user' });
        return;
      }
      console.log(userId);
  
      // Insert folder into the database
      const result = await pool.query('INSERT INTO folders (user_id, folder_name) VALUES ($1, $2) RETURNING *', [userId, folderName]);
  
      res.json({ success: true, folder: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/create-subfolder', authenticateToken, async (req, res) => {
    const { subfolderName, parentFolderId } = req.body;
    const userId = req.user.userId; // Extracted from the token during authentication
  
    try {
      // Check if the user has permission to create a subfolder in the specified parent folder
      const permissionCheckResult = await pool.query('SELECT * FROM folders WHERE id = $1 AND user_id = $2', [parentFolderId, userId]);
  
      if (permissionCheckResult.rows.length === 0) {
        res.status(403).json({ success: false, message: 'Forbidden - You do not have permission to create a subfolder in the specified parent folder' });
        return;
      }
  
      // Check if the subfolder name is unique within the parent folder
      const checkResult = await pool.query('SELECT * FROM subfolders WHERE user_id = $1 AND parent_folder_id = $2 AND subfolder_name = $3', [userId, parentFolderId, subfolderName]);
  
      if (checkResult.rows.length > 0) {
        res.status(400).json({ success: false, message: 'Subfolder name must be unique within the parent folder' });
        return;
      }
  
      // Insert subfolder into the database
      const result = await pool.query('INSERT INTO subfolders (user_id, parent_folder_id, subfolder_name) VALUES ($1, $2, $3) RETURNING *', [userId, parentFolderId, subfolderName]);
  
      res.json({ success: true, subfolder: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

// Upload file endpoint
app.post('/upload-file', authenticateToken, upload.single('file'), async (req, res) => {
    const folderId = req.body.folderID; // Extract folderId from the form data
    const userId = req.user.userId; // Extracted from the token during authentication
    const file = req.file; // Extract file from the form data

  
    try {
      // Check if the user has permission to upload a file to the specified folder
      const permissionCheckResult = await pool.query('SELECT * FROM folders WHERE id = $1 AND user_id = $2', [folderId, userId]);
  
      if (permissionCheckResult.rows.length === 0) {
        res.status(403).json({ success: false, message: 'Forbidden - You do not have permission to upload a file to the specified folder' });
        return;
      }
  
      // Upload file to S3
      const params = {
        Bucket: 'propacity-assignment', 
        Key: file.originalname,
        Body: file.buffer,
        ACL: 'public-read',
      };

      
  
      s3.upload(params, function(err, data) {
        if (err) {
            throw err;
        }
        console.log(`File uploaded successfully. ${data.Location}`);
    });
      
  
      // Record file metadata in the database
      const result = await pool.query(
        'INSERT INTO files (user_id, folder_id, file_name, file_size, upload_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [userId, folderId, file.originalname, file.size, new Date()]
      );
  
      res.json({ success: true, file: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
  
  // Manage files endpoint
app.put('/manage-files/:fileId', authenticateToken, async (req, res) => {
    const { fileId } = req.params;
    const { action, newName, newFolderId } = req.body;
    const userId = req.user.userId; // Extracted from the token during authentication
  
    try {
      // Retrieve file details
      const fileResult = await pool.query('SELECT * FROM files WHERE id = $1 AND user_id = $2', [fileId, userId]);
  
      if (fileResult.rows.length === 0) {
        res.status(404).json({ success: false, message: 'File not found or you do not have permission to manage this file' });
        return;
      }
  
      const file = fileResult.rows[0];
  
      switch (action) {
        case 'rename':
          // Rename the file
          const renameResult = await pool.query('UPDATE files SET file_name = $1 WHERE id = $2 RETURNING *', [newName, fileId]);
          res.json({ success: true, message: 'File renamed successfully', file: renameResult.rows[0] });
          break;
  
          case 'move':
            // Check if the target folder belongs to the user
            const folderCheckResult = await pool.query('SELECT * FROM folders WHERE id = $1 AND user_id = $2', [newFolderId, userId]);
    
            if (folderCheckResult.rows.length === 0) {
              res.status(403).json({ success: false, message: 'Forbidden - You do not have permission to move the file to the specified folder' });
              return;
            }
    
            // Move the file to a new folder
            const moveResult = await pool.query('UPDATE files SET folder_id = $1 WHERE id = $2 RETURNING *', [newFolderId, fileId]);
            res.json({ success: true, message: 'File moved successfully', file: moveResult.rows[0] });
            break;
  
        case 'delete':
          // Delete the file
          await pool.query('DELETE FROM files WHERE id = $1', [fileId]);
          res.json({ success: true, message: 'File deleted successfully' });
          break;
  
        default:
          res.status(400).json({ success: false, message: 'Invalid action. Supported actions: rename, move, delete' });
          break;
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
  
  
  
  // Middleware to authenticate JWT token
  function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
  
    if (!authHeader) {
      return res.status(401).json({ success: false, message: 'Unauthorized - Missing Authorization header' });
    }
  
    const token = authHeader.split(' ')[1];
  
    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized - Missing token' });
    }
  
    jwt.verify(token, secretKey, (err, user) => {
      if (err) {
        console.error('JWT Verification Error:', err);
        return res.status(403).json({ success: false, message: 'Forbidden - Invalid token' });
      }
  
      req.user = user;
      next();
    });
  }

 

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
