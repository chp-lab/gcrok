const { exec } = require("child_process");

function getDisk() {
  return new Promise((resolve, reject) => {
    exec("df -h", (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return reject(error);
      }

      // แยกบรรทัด
      const lines = stdout.trim().split("\n");

      // ใช้ Regular Expression เพื่อจับกลุ่มข้อมูลแต่ละคอลัมน์
      const diskInfo = lines.slice(1).map((line) => {
        // จับกลุ่มข้อมูลด้วย regex
        const columns = line.match(/^(\S+\s\S+|\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)/);
        
        if (columns) {
          return {
            filesystem: columns[1],  // จับไฟล์ระบบหรือ mount point
            size: columns[2],        // ขนาดทั้งหมด
            used: columns[3],        // ใช้ไปแล้ว
            available: columns[4],   // พื้นที่ว่าง
            usePercent: columns[5],  // เปอร์เซ็นต์การใช้งาน
            mountedOn: columns[6],   // ติดตั้งบน
          };
        } else {
          console.error("Error parsing line:", line);
          return null;
        }
      }).filter(Boolean); // กรองค่าที่เป็น null ออกไป

      resolve(diskInfo);
    });
  });
}

module.exports = getDisk;
