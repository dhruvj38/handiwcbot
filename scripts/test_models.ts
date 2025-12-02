
import { GoogleGenAI } from '@google/genai';
import { config } from '../src/config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables
dotenv.config();

// Setup logging to file
const logFile = 'models_output.txt';
fs.writeFileSync(logFile, '');
const log = console.log;
console.log = (...args) => {
    log(...args);
    fs.appendFileSync(logFile, args.join(' ') + '\n');
};

async function listModels() {
    try {
        console.log('Initializing GoogleGenAI client...');
        const apiKey = process.env.AI_API_KEY || config.ai.apiKey;
        if (!apiKey) {
            console.error('API Key is missing!');
            return;
        }
        console.log(`API Key present: ${apiKey.substring(0, 5)}...`);

        const client = new GoogleGenAI({ apiKey });

        // Try to list models using SDK if available
        try {
            console.log('Attempting to list models via SDK...');
            // @ts-ignore
            if (client.models && client.models.list) {
                // @ts-ignore
                const models = await client.models.list();
                console.log('SDK Models List:', JSON.stringify(models, null, 2));
            } else {
                console.log('client.models.list method not found on SDK client.');
            }
        } catch (e: any) {
            console.log('SDK list failed:', e.message);
        }

        // Try raw REST API
        try {
            console.log('Calling REST API list models...');
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (!response.ok) {
                console.log(`REST API failed with status ${response.status}: ${response.statusText}`);
                const errorText = await response.text();
                console.log('Error details:', errorText);
            } else {
                const data = await response.json();
                console.log('REST API Models:', JSON.stringify(data, null, 2));
            }
        } catch (e: any) {
            console.log('REST API failed:', e.message);
        }

        const modelsToTest = [
            'gemini-1.5-flash',
            'gemini-1.5-flash-001',
            'gemini-1.5-pro',
            'gemini-pro',
            'models/gemini-1.5-flash'
        ];

        for (const model of modelsToTest) {
            console.log(`Testing model: ${model}`);
            try {
                const response = await client.models.generateContent({
                    model: model,
                    contents: {
                        role: 'user',
                        parts: [{ text: 'Hello, are you there?' }]
                    }
                });
                console.log(`SUCCESS: Model ${model} works!`);
                console.log('Response:', response.text);
                return; // Found a working model
            } catch (error: any) {
                console.log(`FAILED: Model ${model} - ${error.message}`);
            }
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

listModels();
