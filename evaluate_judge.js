const axios = require('axios');

const JUDGE_URL = 'http://localhost:8000/api/v2/piston/execute';

const TEST_PAYLOADS = {
    python: {
        language: 'python',
        code: `
import sys
if __name__ == "__main__":
    line = sys.stdin.read().strip()
    if not line:
        print("0")
    else:
        parts = line.split()
        print(int(parts[0]) + int(parts[1]))
`,
        inputs: Array.from({ length: 50 }, (_, i) => `${i} ${i}`)
    },
    javascript: {
        language: 'javascript',
        code: `
const fs = require('fs');
const input = fs.readFileSync(0, 'utf-8').trim();
if (!input) {
    console.log("0");
} else {
    const parts = input.split(/\\s+/);
    console.log(parseInt(parts[0]) + parseInt(parts[1]));
}
`,
        inputs: Array.from({ length: 50 }, (_, i) => `${i} ${i}`)
    },
    cpp: {
    language: 'cpp',
    code: `
#include <iostream>
using namespace std;

int main() {
    int a, b;
    if (!(cin >> a >> b)) {
        cout << 0;
        return 0;
    }
    cout << a + b;
    return 0;
}
`,
    inputs: Array.from({ length: 50 }, (_, i) => `${i} ${i}`)
},

java: {
    language: 'java',
    code: `
import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);

        if (!sc.hasNextInt()) {
            System.out.println(0);
            return;
        }

        int a = sc.nextInt();
        int b = sc.nextInt();

        System.out.println(a + b);
    }
}
`,
    inputs: Array.from({ length: 50 }, (_, i) => `${i} ${i}`)
}
};

async function testLanguage(lang) {
    console.log(`\n🧪 Testing ${lang.toUpperCase()} (Batch: 50 inputs)...`);
    const data = TEST_PAYLOADS[lang];

    // Construct payload with BATCH support
    const payload = {
        language: data.language,
        files: [{ content: data.code }],
        inputs: data.inputs
    };

    const start = Date.now();
    try {
        const res = await axios.post(JUDGE_URL, payload);
        const duration = Date.now() - start;

        const results = res.data.results || [];
        const passed = results.filter((r, i) => {
            const expected = (i + i).toString();
            return r.stdout.trim() === expected;
        }).length;

        console.log(`✅ Completed in ${duration}ms`);
        console.log(`📊 Results: ${passed}/50 passed`);
        console.log(`⚡ Rate: ~${(50 / (duration / 1000)).toFixed(1)} tests/sec`);

        if (passed === 50) console.log('🌟 Verdict: BATCHING WORKS & IS FAST');
        else console.log('⚠️ Verdict: Logic correct but output mismatch?');

    } catch (err) {
        console.error(`❌ Failed: ${err.message}`);
        if (err.code === 'ECONNREFUSED') {
            console.error('   -> Make sure "node server.js" is running in another terminal!');
        } else if (err.response) {
            console.error('   -> Server returned:', err.response.data);
        }
    }
}

async function run() {
    console.log('🚀 Step 1: Evaluating Judge Performance...');
    await testLanguage('python');
    await testLanguage('javascript');
    await testLanguage('cpp');
    await testLanguage('java')
    console.log('\n(Skipping C++/Java as they require local compilers, but logic is identical)');
}

run();
