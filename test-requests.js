// test-requests.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const url = 'https://mirrorme-jqjj87z9k-timothy-oudeboons-projects.vercel.app/webhook/card-moved';

async function testRequests() {
    console.log('Testing different request types...\n');

    // Test 1: Simple HEAD
    try {
        console.log('Test 1: Simple HEAD request');
        const response = await fetch(url, { method: 'HEAD' });
        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
        console.log('\n');
    } catch (error) {
        console.error('Error:', error);
    }

    // Test 2: HEAD with Content-Type
    try {
        console.log('Test 2: HEAD with Content-Type');
        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
        console.log('\n');
    } catch (error) {
        console.error('Error:', error);
    }

    // Test 3: HEAD with empty body
    try {
        console.log('Test 3: HEAD with empty body');
        const response = await fetch(url, {
            method: 'HEAD',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
        console.log('\n');
    } catch (error) {
        console.error('Error:', error);
    }

    // Test 4: GET request
    try {
        console.log('Test 4: GET request');
        const response = await fetch(url);
        console.log('Status:', response.status);
        const text = await response.text();
        console.log('Response:', text);
        console.log('\n');
    } catch (error) {
        console.error('Error:', error);
    }
}

testRequests().catch(console.error);