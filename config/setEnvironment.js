const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");
const os = require("os");

class setEnvironment {
  constructor(platform) {
    this.platform = platform;
    this.defaultTemplate = {
      version: "3",
      agent: {
        authtoken: "",
      },
    };
    this.gcrokPath;
    const homeDir = os.homedir();
    // console.log(homeDir);
    // console.log(process.env.HOMEPATH);

    if (platform === "darwin") {
      this.gcrokPath = path.join(
        homeDir,
        "Library",
        "Application Support",
        "gcrok",
        "gcrok.yml"
      );
    } else if (platform === "linux") {
      this.gcrokPath = path.join(homeDir, ".config", "gcrok", "gcrok.yml");
      console.log("gcrokPath:", this.gcrokPath);
    } else if (platform == "win32") {
      // process.env.HOMEPATH,
      this.gcrokPath = path.join(
        homeDir,
        "AppData",
        "Local",
        "gcrok",
        "gcrok.yml"
      );
    }
  }

  setValueENV(key, value) {
    let data = {};

    // เช็คว่าไฟล์ ngrok.yml มีอยู่หรือไม่
    if (fs.existsSync(this.gcrokPath)) {
      // console.log("gcrok.yml found.");

      // ถ้ามีไฟล์แล้ว ให้โหลดข้อมูล
      try {
        let fileContents = fs.readFileSync(this.gcrokPath, "utf8");
        data = yaml.load(fileContents) || this.defaultTemplate;
      } catch (e) {
        console.error("Error reading gcrok.yml:", e);
        return;
      }
    } else {
      console.log("gcrok.yml not found. Creating new file.");

      // ถ้าไม่มีไฟล์ ให้สร้างใหม่โดยใช้ template เริ่มต้น
      data = this.defaultTemplate;

      // สร้าง directory ถ้ายังไม่มี
      const dirPath = path.dirname(this.gcrokPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    }

    // ตั้งค่าคีย์ใหม่ในส่วน agent
    if (data.agent) {
      data.agent[key] = value;
    }

    // เขียนข้อมูลกลับไปในไฟล์ YAML
    try {
      let yamlStr = yaml.dump(data);
      fs.writeFileSync(this.gcrokPath, yamlStr, "utf8");
      console.info(`${key} set to ${value} in gcrok.yml`);
    } catch (e) {
      console.error("Error writing to gcrok.yml:", e);
    }
  }

  getValueENV() {
    if (fs.existsSync(this.gcrokPath)) {
      try {
        
        let fileContents = fs.readFileSync(this.gcrokPath, "utf8");
        let data = yaml.load(fileContents);
        //   console.log("Contents of gcrok.yml:", data);
        return data;
      } catch (e) {
        console.error("Error reading gcrok.yml:", e);
      }
    } else {
      console.log("Please create gcrok.yml at:", this.gcrokPath);
      console.log(`Sample contents
        version: '3'
          agent:
          authtoken: your_auth_atoken`)
      console.log("gcrok.yml not found.");
      // process.exit(1);
      return null
    }
  }
}

module.exports = setEnvironment;
