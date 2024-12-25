import { AppError } from '../utils/error';
import { Config } from '../config';

export class ImageGenerationService {
  constructor(private config: Config) {}

  async generateImage(prompt: string, model: string, size: string, numSteps: number): Promise<{ prompt: string, translatedPrompt: string, image: string }> {
    console.log("Generating image with params:", { prompt, model, size, numSteps });
    const translatedPrompt = await this.translatePrompt(prompt);
    console.log("Translated prompt:", translatedPrompt);
    const isFluxModel = model === this.config.CUSTOMER_MODEL_MAP["FLUX.1-Schnell-CF"];
    let imageBase64;
    try {
      imageBase64 = isFluxModel ? 
        await this.generateFluxImage(model, translatedPrompt, numSteps) :
        await this.generateStandardImage(model, translatedPrompt, size, numSteps);
    } catch (error) {
      console.error("Error in image generation:", error);
      throw error;
    }

    return {
      prompt,
      translatedPrompt,
      image: imageBase64
    };
  }

  private async translatePrompt(prompt: string): Promise<string> {
    if (!this.config.CF_IS_TRANSLATE) {
      return prompt;
    }

    try {
      const response = await this.postRequest(this.config.CF_TRANSLATE_MODEL, {
        messages: [
          {
            role: "system",
            content: `### Optimized Prompt  

You are a prompt generation assistant based on the Flux.1 model. Your task is to create highly detailed, flexible, and precise prompts for drawing requests based on user needs. While you may reference provided templates to understand structural patterns, you must adapt dynamically to diverse requirements. Your output must **strictly be in English**, providing only the finalized prompt with no further explanation.  

---

### **Prompt Generation Logic**  

1. **Understanding User Requirements**: Extract key information from the description, such as:  
   - **Characters**: Appearance, actions, expressions, etc.  
   - **Scenes**: Environment, lighting, weather, etc.  
   - **Style**: Artistic style, emotional atmosphere, color palette, etc.  
   - **Additional Elements**: Specific objects, background details, special effects, etc.  

2. **Prompt Structure and Guidelines**:  
   - **Concise, Precise, and Specific**: The prompt must clearly define the core subject while including sufficient details to guide image generation.  
   - **Flexible and Adaptive**: Refer to examples as inspiration but ensure prompts are customized and avoid over-reliance on templates.  
   - **Flux.1 Compliance**: Prompts should follow Flux.1 conventions by incorporating artistic style, visual effects, and emotional atmosphere. Use keywords and descriptions consistent with the Flux.1 model to achieve optimal results.  

3. **Examples for Reference and Learning**:  

   - **Character Expressions**:  
     *Scenario*: For designing varied character expressions (happy, sad, angry, etc.) in a reference sheet format.  
     *Prompt*:  
     //An anime character design expression reference sheet, featuring the same character in different emotional states: happy, sad, angry, scared, nervous, embarrassed, confused, neutral. Turnaround format with clean, soft line art, pastel tones, minimalistic kawaii style, dreamy and nostalgic vibe.//

   - **Full-Angle Character Views**:  
     *Scenario*: For creating full-body images of a character from different angles (front, side, back).  
     *Prompt*:  
     //A detailed character sheet of [SUBJECT], showing the character in front, side, and back views. Clean digital artwork with precise proportions, vibrant colors, and a professional concept art style.//

   - **1980s Retro Style**:  
     *Scenario*: To create nostalgic Polaroid-style imagery.  
     *Prompt*:  
     //A blurry Polaroid of a 1980s living room, featuring vintage furniture, warm pastel tones, grainy textures, and sunlight filtering through sheer curtains. Nostalgic atmosphere with soft shadows and a cozy vibe.//

   - **Double Exposure Effect**:  
     *Scenario*: For artistic photography or illustrations using a double exposure effect.  
     *Prompt*:  
     //A double exposure photograph of a silhouette of a man's head with abstract waterfalls and wildlife blended inside. Dreamlike atmosphere, vibrant colors, expressive and imaginative style, highly detailed.//

   - **High-Quality Movie Poster**:  
     *Scenario*: For creating cinematic and eye-catching posters.  
     *Prompt*:  
     //A digital illustration of a movie poster titled "Sad Sax: Fury Toad," a parody of Mad Max, featuring a saxophone-playing toad in a post-apocalyptic desert. In the background, a wasteland with musical instrument vehicles in pursuit. Dusty, gritty visuals with intense, bold typography and a dramatic color palette.//

4. **Core Principles of Flux.1 Prompts**:  
   - **Precise Subject Definition**: Clearly describe the primary subject or scene.  
   - **Detailed Style and Emotional Atmosphere**: Include artistic style, lighting, color palettes, and emotional tone.  
   - **Dynamic and Specific Details**: Incorporate actions, emotions, or lighting effects to enhance depth.  

5. **Reminder**:  
   - Always provide a polished and Flux.1-compliant prompt.  
   - No Chinese or additional explanations in the output.  
   - Ensure prompts are adaptive and meet any artistic demand.  
`
          },
          {
            role: "user",
            content: `请优化并翻译以下提示词：${prompt}`
          }
        ]
      });

      const jsonResponse = await response.json();
      return jsonResponse.result.response.trim();
    } catch (error) {
      console.error("翻译提示词时出错:", error);
      return prompt; // 如果翻译失败,返回原始提示词
    }
  }

  private async generateStandardImage(model: string, prompt: string, size: string, numSteps: number): Promise<string> {
    const [width, height] = size.split('x').map(Number);
    const jsonBody = { prompt, num_steps: numSteps, guidance: 7.5, strength: 1, width, height };
    const response = await this.postRequest(model, jsonBody);
    const imageBuffer = await response.arrayBuffer();
    return this.arrayBufferToBase64(imageBuffer);
  }

  private async generateFluxImage(model: string, prompt: string, numSteps: number): Promise<string> {
    const jsonBody = { prompt, num_steps: numSteps };
    const response = await this.postRequest(model, jsonBody);
    const jsonResponse = await response.json();
    if (!jsonResponse.result || !jsonResponse.result.image) {
      throw new AppError('Invalid response from Flux model', 500);
    }
    return jsonResponse.result.image;
  }

  private async postRequest(model: string, jsonBody: any): Promise<Response> {
    const account = this.config.CF_ACCOUNT_LIST[Math.floor(Math.random() * this.config.CF_ACCOUNT_LIST.length)];
    const url = `https://api.cloudflare.com/client/v4/accounts/${account.account_id}/ai/run/${model}`;
    const headers = {
      'Authorization': `Bearer ${account.token}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(jsonBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Cloudflare API request failed: ${response.status}`, errorText);
        throw new AppError(`Cloudflare API request failed: ${response.status} - ${errorText}`, response.status);
      }

      return response;
    } catch (error) {
      console.error("Error in postRequest:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to connect to Cloudflare API', 500);
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
    return btoa(binary);
  }

  async testCfAiConnection(): Promise<void> {
    const testModel = this.config.CF_TRANSLATE_MODEL;
    const testPrompt = "Hello, world!";
    await this.postRequest(testModel, { messages: [{ role: "user", content: testPrompt }] });
  }
}