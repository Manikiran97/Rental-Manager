import { GoogleGenerativeAI } from '@google/generative-ai';

export const scanBillWithGeminiNative = async (apiKey, base64Image) => {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    const prompt = `
You are an expert reading Indian Electricity Bills. 
Look closely at the image of the electricity bill provided.
Extract two things:
1) The "Meter Number" (Might be labeled "Meter No", "USC No", "SC No", etc. Try to match the 8-15 digit long numeric/alphanumeric code).
2) The EXACT amount printed next to the words "Bill Amount". (Do NOT use the final Total Due, use the pre-subsidy Bill Amount).

Respond ONLY with a valid JSON document containing the exact matching keys: "meter_number" and "amount". 
Failure to use the exact key "amount" will break the system. Do NOT name it "total_due".
Do NOT include markdown formatting or backticks around the json. 
Example exact output format:
{"meter_number": "1101605809", "amount": 867}
`;

    const imagePart = {
      inlineData: { data: base64Image, mimeType: "image/jpeg" },
    };

    const modelObj = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const result = await modelObj.generateContent([prompt, imagePart]);

    const response = await result.response;
    if (!response) {
       return { success: false, error: "Empty response from AI." };
    }
    
    const text = response.text();
    if (!text) {
       return { success: false, error: "AI returned empty text content." };
    }
    
    // Robustly extract just the JSON block using Regex
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: "AI didn't return a JSON structure. Try a clearer photo." };

    const parsed = JSON.parse(jsonMatch[0]);
    const normalizedJSON = {};
    for (const [key, value] of Object.entries(parsed)) {
        normalizedJSON[key.toLowerCase().replace(/ /g, '_')] = value;
    }

    let finalAmount = null;
    const possibleKeys = ['amount', 'total_due', 'total', 'bill_amount', 'net_amount'];
    for (const pk of possibleKeys) {
        if (normalizedJSON[pk] !== undefined) {
            finalAmount = normalizedJSON[pk];
            break;
        }
    }
    
    if (finalAmount === null) {
        const amountKey = Object.keys(normalizedJSON).find(k => 
            k !== 'meter_number' && k !== 'meter' && !k.includes('no') && !k.includes('sc') && !k.includes('usc') &&
            (typeof normalizedJSON[k] === 'number' || (!isNaN(parseFloat(normalizedJSON[k])) && parseFloat(normalizedJSON[k]) >= 0))
        );
        if (amountKey) finalAmount = normalizedJSON[amountKey];
    }
    
    return { success: true, ...normalizedJSON, amount: finalAmount !== null ? finalAmount : 0 };
  } catch (err) {
    console.error("AI Scan Crash:", err);
    let userFriendlyError = err.message;
    if (userFriendlyError.includes("500")) {
       userFriendlyError = "Google AI Servers are temporarily overloaded (Error 500). Please try again in 10 seconds.";
    } else if (userFriendlyError.includes("403")) {
       userFriendlyError = "API Key error or blocked region. Check your billing/settings.";
    }
    return { success: false, error: userFriendlyError };
  }
};
