const { spawn } = require('child_process');
const path = require('path');

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Get query from path parameters
  const query = event.path.split('/').pop();
  
  if (!query) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'No search query provided' })
    };
  }

  try {
    const pythonScript = path.join(__dirname, 'reddit_script.py');
    const pythonProcess = spawn('python3', [pythonScript, query], {
      env: {
        ...process.env,
        REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
        REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET
      }
    });

    return new Promise((resolve, reject) => {
      let dataString = '';
      let errorString = '';

      pythonProcess.stdout.on('data', (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        errorString += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          resolve({
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: errorString || 'Python script failed' })
          });
          return;
        }

        try {
          const jsonData = JSON.parse(dataString);
          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify(jsonData)
          });
        } catch (e) {
          resolve({
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to parse Python output' })
          });
        }
      });

      pythonProcess.on('error', (err) => {
        resolve({
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: err.message })
        });
      });
    });
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
